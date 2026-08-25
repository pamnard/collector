import { describe, expect, it, vi } from "vitest";
import type { JobRow } from "./job-store-types.js";
import { createJobPoll } from "./job-runner-poll.js";

function runningJob(id: string): JobRow {
  return {
    id,
    type: "__test_noop",
    payload_json: "{}",
    status: "running",
    priority: 0,
    idempotency_key: null,
    attempts: 0,
    max_attempts: 3,
    available_at: "2020-01-01T00:00:00.000Z",
    started_at: "2020-01-01T00:00:00.000Z",
    finished_at: null,
    last_error: null,
    created_at: "2020-01-01T00:00:00.000Z",
    updated_at: "2020-01-01T00:00:00.000Z",
  };
}

describe("createJobPoll", () => {
  it("returns claimed job to pending when stop happens before execute", async () => {
    const job = runningJob("job-1");
    let stopped = false;
    const releaseClaim = vi.fn(async () => undefined);
    const executeJob = vi.fn(async () => undefined);
    const claimNext = vi.fn(async () => {
      stopped = true;
      return job;
    });

    const poll = createJobPoll({
      store: {
        claimNext,
        releaseClaim,
      } as never,
      concurrency: 1,
      pollIntervalMs: 1000,
      now: () => new Date("2020-01-01T00:00:00.000Z"),
      executeJob,
      isStopped: () => stopped,
    });

    await poll.runTick();

    expect(claimNext).toHaveBeenCalledOnce();
    expect(releaseClaim).toHaveBeenCalledWith(
      "job-1",
      "2020-01-01T00:00:00.000Z",
    );
    expect(executeJob).not.toHaveBeenCalled();
  });

  it("skips claiming vault-mutating bulk jobs while one is already in flight", async () => {
    const bulkJob = {
      ...runningJob("bulk-1"),
      type: "vaultIndexSync",
    };
    const claimNext = vi.fn(
      async (
        _nowIso: string,
        opts?: { skipVaultMutatingBulkJobs?: boolean },
      ) => {
        if (opts?.skipVaultMutatingBulkJobs) {
          return null;
        }
        return bulkJob;
      },
    );
    let resolveExecute: (() => void) | undefined;
    const executeJob = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveExecute = resolve;
        }),
    );

    let stopped = false;
    const poll = createJobPoll({
      store: { claimNext, releaseClaim: vi.fn() } as never,
      concurrency: 2,
      pollIntervalMs: 1000,
      now: () => new Date("2020-01-01T00:00:00.000Z"),
      executeJob,
      isStopped: () => stopped,
    });

    try {
      await poll.runTick();
      // claimed>0 && inFlight < concurrency arms schedulePoll(0); disarm before asserts.
      poll.clearPollTimer();

      expect(executeJob).toHaveBeenCalledTimes(1);
      expect(claimNext).toHaveBeenCalledTimes(2);
      expect(claimNext).toHaveBeenNthCalledWith(
        1,
        "2020-01-01T00:00:00.000Z",
        { skipVaultMutatingBulkJobs: false },
      );
      expect(claimNext).toHaveBeenNthCalledWith(
        2,
        "2020-01-01T00:00:00.000Z",
        { skipVaultMutatingBulkJobs: true },
      );
    } finally {
      stopped = true;
      poll.clearPollTimer();
      resolveExecute?.();
    }
  });

  it("wake is a no-op after stop", async () => {
    let stopped = false;
    const claimNext = vi.fn(async () => null);
    const poll = createJobPoll({
      store: { claimNext } as never,
      concurrency: 1,
      pollIntervalMs: 50,
      now: () => new Date("2020-01-01T00:00:00.000Z"),
      executeJob: vi.fn(async () => undefined),
      isStopped: () => stopped,
    });

    await poll.runTick();
    expect(claimNext).toHaveBeenCalledOnce();
    stopped = true;
    poll.clearPollTimer();
    poll.wake();
    expect(claimNext).toHaveBeenCalledOnce();
  });
});
