import type { JobHandlerResult, JobHandlers } from "./job-types.js";
import type { JobRow, JobStore } from "./job-store.js";

export interface JobRunnerOptions {
  store: JobStore;
  handlers: JobHandlers;
  concurrency: number;
  timeoutMs: number;
  /** Idle heartbeat for delayed jobs (`available_at` in the future). */
  pollIntervalMs: number;
  now: () => Date;
}

export function createJobRunner(options: JobRunnerOptions) {
  const {
    store,
    handlers,
    concurrency,
    timeoutMs,
    pollIntervalMs,
    now,
  } = options;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = true;
  let tickRunning = false;
  const inFlight = new Set<Promise<void>>();

  function clearPollTimer(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedulePoll(delayMs: number): void {
    if (stopped) {
      return;
    }
    clearPollTimer();
    timer = setTimeout(() => {
      timer = null;
      void runTick();
    }, delayMs);
  }

  /** Wake the poll loop (enqueue, job finished, or start). */
  function wake(): void {
    if (stopped) {
      return;
    }
    schedulePoll(0);
  }

  async function executeJob(job: JobRow): Promise<void> {
    const nowIso = () => now().toISOString();
    const handler = handlers[job.type];
    if (!handler) {
      await store.markFailed(
        job.id,
        nowIso(),
        `no handler registered for job type: ${job.type}`,
      );
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(job.payload_json) as unknown;
    } catch (err) {
      await store.markFailed(
        job.id,
        nowIso(),
        `invalid payload_json: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    let result: JobHandlerResult;
    try {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      result = await Promise.race([
        handler({
          id: job.id,
          type: job.type,
          payload,
          attempts: job.attempts,
        }).finally(() => {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
        }),
        new Promise<JobHandlerResult>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`job timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      await store.scheduleRetry({
        id: job.id,
        nowIso: nowIso(),
        availableAt: nowIso(),
        error: message,
        burnAttempt: true,
      });
      return;
    }

    if (result.status === "ok") {
      await store.markSucceeded(job.id, nowIso());
      return;
    }

    if (!result.retryable) {
      await store.markFailed(job.id, nowIso(), result.error);
      return;
    }

    if (result.retryAfterMs !== undefined) {
      const availableAt = new Date(
        now().getTime() + result.retryAfterMs,
      ).toISOString();
      await store.scheduleRetry({
        id: job.id,
        nowIso: nowIso(),
        availableAt,
        error: result.error,
        burnAttempt: false,
      });
      return;
    }

    await store.scheduleRetry({
      id: job.id,
      nowIso: nowIso(),
      availableAt: nowIso(),
      error: result.error,
      burnAttempt: true,
    });
  }

  async function runTick(): Promise<void> {
    if (stopped || tickRunning) {
      return;
    }
    tickRunning = true;
    let claimed = 0;
    try {
      while (!stopped && inFlight.size < concurrency) {
        const job = await store.claimNext(now().toISOString());
        if (!job) {
          break;
        }
        claimed += 1;
        const run = executeJob(job).finally(() => {
          inFlight.delete(run);
          wake();
        });
        inFlight.add(run);
      }
    } finally {
      tickRunning = false;
      if (stopped) {
        return;
      }
      if (claimed > 0 && inFlight.size < concurrency) {
        schedulePoll(0);
        return;
      }
      if (inFlight.size === 0) {
        // Heartbeat for delayed `available_at` jobs while idle.
        schedulePoll(pollIntervalMs);
      }
    }
  }

  return {
    start() {
      if (!stopped) {
        return;
      }
      stopped = false;
      void store.reclaimRunning(now().toISOString()).then(() => wake());
    },
    async stop() {
      stopped = true;
      clearPollTimer();
      await Promise.allSettled([...inFlight]);
    },
    wake,
    /** Test helper: run one poll cycle. */
    tick: runTick,
  };
}

export type JobRunner = ReturnType<typeof createJobRunner>;
