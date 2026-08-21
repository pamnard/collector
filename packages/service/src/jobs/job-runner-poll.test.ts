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
});
