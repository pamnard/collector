import type { JobPermanentFailure } from "@collector/api";
import type { JobRegistry } from "./job-registry.js";
import type { JobStore } from "./job-store.js";
import {
  reportPermanentFailure as logPermanentFailure,
  type ReportPermanentFailure,
} from "./job-runner-failure.js";
import { createApplyRetry } from "./job-runner-retry.js";
import { createExecuteJob } from "./job-runner-execute.js";
import { createJobPoll } from "./job-runner-poll.js";

export interface JobRunnerOptions {
  store: JobStore;
  registry: JobRegistry;
  concurrency: number;
  timeoutMs: number;
  /** Idle heartbeat for delayed jobs (`available_at` in the future). */
  pollIntervalMs: number;
  now: () => Date;
  /** Fired once when a job reaches terminal `failed`. */
  onPermanentFailure?: (info: JobPermanentFailure) => void;
  /** Fired when a claimed job settles (success/fail/retry scheduling). */
  onActivity?: () => void;
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
    onActivity,
  } = options;

  let stopped = true;

  const reportPermanentFailure: ReportPermanentFailure = (
    job,
    error,
    attempts,
  ) => logPermanentFailure(job, error, attempts, onPermanentFailure);

  const applyRetry = createApplyRetry({
    store,
    now,
    reportPermanentFailure,
  });
  const executeJob = createExecuteJob({
    store,
    registry,
    timeoutMs,
    now,
    applyRetry,
    reportPermanentFailure,
  });
  const poll = createJobPoll({
    store,
    concurrency,
    pollIntervalMs,
    now,
    executeJob,
    isStopped: () => stopped,
    onActivity,
  });

  return {
    start() {
      if (!stopped) {
        return;
      }
      stopped = false;
      void store.reclaimRunning(now().toISOString()).then(() => poll.wake());
    },
    async stop() {
      stopped = true;
      poll.clearPollTimer();
      await poll.waitForIdle();
    },
    wake: poll.wake,
    /** Test helper: run one poll cycle. */
    tick: poll.runTick,
  };
}

export type JobRunner = ReturnType<typeof createJobRunner>;
