import type { JobPermanentFailure } from "@collector/api";
import type { JobRegistry } from "./job-registry.js";
import type { JobHandlerResult } from "./job-types.js";
import type { JobRow, JobStore } from "./job-store.js";

export type JobPermanentFailureInfo = JobPermanentFailure;

export interface JobRunnerOptions {
  store: JobStore;
  registry: JobRegistry;
  concurrency: number;
  timeoutMs: number;
  /** Idle heartbeat for delayed jobs (`available_at` in the future). */
  pollIntervalMs: number;
  now: () => Date;
  /** Fired once when a job reaches terminal `failed` (#630). */
  onPermanentFailure?: (info: JobPermanentFailureInfo) => void;
}

export function createJobRunner(options: JobRunnerOptions) {
  const {
    store,
    registry,
    concurrency,
    timeoutMs,
    pollIntervalMs,
    now,
    onPermanentFailure,
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

  async function reportPermanentFailure(
    job: JobRow,
    error: string,
  ): Promise<void> {
    const row = await store.getJob(job.id);
    const attempts = row?.attempts ?? job.attempts;
    const info: JobPermanentFailureInfo = {
      id: job.id,
      type: job.type,
      error,
      attempts,
    };
    console.error("[jobs] permanent failure", {
      jobId: info.id,
      type: info.type,
      error: info.error,
      attempts: info.attempts,
    });
    onPermanentFailure?.(info);
  }

  async function executeJob(job: JobRow): Promise<void> {
    const nowIso = () => now().toISOString();
    if (!registry.has(job.type)) {
      const error = `no handler registered for job type: ${job.type}`;
      await store.markFailed(job.id, nowIso(), error);
      await reportPermanentFailure(job, error);
      return;
    }
    const entry = registry.requireEntry(job.type);

    let raw: unknown;
    try {
      raw = JSON.parse(job.payload_json) as unknown;
    } catch (err) {
      const error = `invalid payload_json: ${err instanceof Error ? err.message : String(err)}`;
      await store.markFailed(job.id, nowIso(), error);
      await reportPermanentFailure(job, error);
      return;
    }

    let payload: unknown;
    try {
      payload = registry.parsePayload(job.type, raw);
    } catch (err) {
      const error = `invalid job payload: ${err instanceof Error ? err.message : String(err)}`;
      await store.markFailed(job.id, nowIso(), error);
      await reportPermanentFailure(job, error);
      return;
    }

    let result: JobHandlerResult;
    try {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      result = await Promise.race([
        entry
          .handler({
            id: job.id,
            type: job.type,
            payload,
            attempts: job.attempts,
          })
          .finally(() => {
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
      const outcome = await store.scheduleRetry({
        id: job.id,
        nowIso: nowIso(),
        availableAt: nowIso(),
        error: message,
        burnAttempt: true,
      });
      if (outcome === "failed") {
        await reportPermanentFailure(job, message);
      } else {
        console.info("[jobs] retry scheduled", {
          jobId: job.id,
          type: job.type,
          error: message,
        });
      }
      return;
    }

    if (result.status === "ok") {
      await store.markSucceeded(job.id, nowIso());
      console.info("[jobs] succeeded", {
        jobId: job.id,
        type: job.type,
      });
      return;
    }

    if (!result.retryable) {
      await store.markFailed(job.id, nowIso(), result.error);
      await reportPermanentFailure(job, result.error);
      return;
    }

    if (result.retryAfterMs !== undefined) {
      const availableAt = new Date(
        now().getTime() + result.retryAfterMs,
      ).toISOString();
      const outcome = await store.scheduleRetry({
        id: job.id,
        nowIso: nowIso(),
        availableAt,
        error: result.error,
        burnAttempt: false,
      });
      if (outcome === "failed") {
        await reportPermanentFailure(job, result.error);
      } else {
        console.info("[jobs] retry scheduled", {
          jobId: job.id,
          type: job.type,
          error: result.error,
          retryAfterMs: result.retryAfterMs,
        });
      }
      return;
    }

    const outcome = await store.scheduleRetry({
      id: job.id,
      nowIso: nowIso(),
      availableAt: nowIso(),
      error: result.error,
      burnAttempt: true,
    });
    if (outcome === "failed") {
      await reportPermanentFailure(job, result.error);
    } else {
      console.info("[jobs] retry scheduled", {
        jobId: job.id,
        type: job.type,
        error: result.error,
      });
    }
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
