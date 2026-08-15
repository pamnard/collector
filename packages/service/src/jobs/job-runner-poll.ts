import type { JobStore } from "./job-store.js";
import type { ExecuteJob } from "./job-runner-execute.js";

export function createJobPoll(deps: {
  store: JobStore;
  concurrency: number;
  pollIntervalMs: number;
  now: () => Date;
  executeJob: ExecuteJob;
  isStopped: () => boolean;
}) {
  const { store, concurrency, pollIntervalMs, now, executeJob, isStopped } =
    deps;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let tickRunning = false;
  const inFlight = new Set<Promise<void>>();

  function clearPollTimer(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedulePoll(delayMs: number): void {
    if (isStopped()) {
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
    if (isStopped()) {
      return;
    }
    schedulePoll(0);
  }

  async function runTick(): Promise<void> {
    if (isStopped() || tickRunning) {
      return;
    }
    tickRunning = true;
    let claimed = 0;
    try {
      while (!isStopped() && inFlight.size < concurrency) {
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
      if (isStopped()) {
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

  async function waitForIdle(): Promise<void> {
    await Promise.allSettled([...inFlight]);
  }

  return {
    clearPollTimer,
    wake,
    runTick,
    waitForIdle,
  };
}

export type JobPoll = ReturnType<typeof createJobPoll>;
