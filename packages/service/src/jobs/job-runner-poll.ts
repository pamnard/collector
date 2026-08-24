import { isVaultMutatingBulkJob } from "@collector/shared";
import type { JobRow, JobStore } from "./job-store.js";
import type { ExecuteJob } from "./job-runner-execute.js";
import {
  canClaimMore,
  settlePollTick,
  shouldSkipVaultMutatingBulk,
} from "./job-runner-poll-phases.js";

export function createJobPoll(deps: {
  store: JobStore;
  concurrency: number;
  pollIntervalMs: number;
  now: () => Date;
  executeJob: ExecuteJob;
  isStopped: () => boolean;
  onActivity?: () => void;
}) {
  const { store, concurrency, pollIntervalMs, now, executeJob, isStopped, onActivity } =
    deps;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let tickRunning = false;
  const inFlight = new Set<Promise<void>>();
  let vaultMutatingBulkJobsInFlight = 0;

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

  async function claimPhase(): Promise<number> {
    let claimed = 0;
    while (
      canClaimMore({
        isStopped: isStopped(),
        inFlightSize: inFlight.size,
        concurrency,
      })
    ) {
      const job = await store.claimNext(now().toISOString(), {
        skipVaultMutatingBulkJobs: shouldSkipVaultMutatingBulk(
          vaultMutatingBulkJobsInFlight,
        ),
      });
      if (!job) {
        break;
      }
      // claimNext awaits; stop may have begun meanwhile — do not start new work.
      // Job is already `running` in the store; release before break or it orphans until reclaim.
      if (isStopped()) {
        await store.releaseClaim(job.id, now().toISOString());
        break;
      }
      claimed += 1;
      runPhase(job);
    }
    return claimed;
  }

  function runPhase(job: JobRow): void {
    const holdsBulkSlot = isVaultMutatingBulkJob(job);
    if (holdsBulkSlot) {
      vaultMutatingBulkJobsInFlight += 1;
    }
    const run = executeJob(job).finally(() => {
      inFlight.delete(run);
      if (holdsBulkSlot) {
        vaultMutatingBulkJobsInFlight -= 1;
      }
      onActivity?.();
      // wake() no-ops when stopped.
      wake();
    });
    inFlight.add(run);
  }

  function settlePhase(claimed: number): void {
    const action = settlePollTick({
      isStopped: isStopped(),
      claimed,
      inFlightSize: inFlight.size,
      concurrency,
      pollIntervalMs,
    });
    if (action.kind === "immediate") {
      schedulePoll(0);
      return;
    }
    if (action.kind === "heartbeat") {
      schedulePoll(action.delayMs);
    }
  }

  async function runTick(): Promise<void> {
    if (isStopped() || tickRunning) {
      return;
    }
    tickRunning = true;
    let claimed = 0;
    try {
      claimed = await claimPhase();
    } finally {
      // Clear before settle so a scheduled immediate tick is not skipped.
      tickRunning = false;
      settlePhase(claimed);
    }
  }

  async function waitForIdle(): Promise<void> {
    for (;;) {
      if (tickRunning) {
        await new Promise<void>((resolve) => {
          setImmediate(resolve);
        });
        continue;
      }
      const pending = [...inFlight];
      if (pending.length === 0) {
        return;
      }
      await Promise.allSettled(pending);
    }
  }

  return {
    clearPollTimer,
    wake,
    runTick,
    waitForIdle,
  };
}

export type JobPoll = ReturnType<typeof createJobPoll>;
