import { describe, expect, it, vi } from "vitest";
import { testNoopJobType } from "@collector/shared";
import { createExecuteJob } from "./job-runner-execute.js";
import { createJobRegistry } from "./job-registry.js";
import type { JobRow, JobStore } from "./job-store.js";

function jobRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: "job-garbage",
    type: testNoopJobType.id,
    payload_json: "{}",
    status: "running",
    priority: 0,
    idempotency_key: null,
    attempts: 1,
    max_attempts: 3,
    available_at: "2020-01-01T00:00:00.000Z",
    started_at: "2020-01-01T00:00:00.000Z",
    finished_at: null,
    last_error: null,
    created_at: "2020-01-01T00:00:00.000Z",
    updated_at: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("createExecuteJob settle (#793 review)", () => {
  it("settles unexpected handler result as permanent failure (does not leave running)", async () => {
    const registry = createJobRegistry([testNoopJobType]);
    registry.register(testNoopJobType, async () => {
      return { status: "wat" } as never;
    });

    const markFailed = vi.fn(async () => undefined);
    const markSucceeded = vi.fn(async () => undefined);
    const reportPermanentFailure = vi.fn();
    const applyRetry = vi.fn(async () => undefined);

    const executeJob = createExecuteJob({
      store: { markFailed, markSucceeded } as unknown as JobStore,
      registry,
      timeoutMs: 1000,
      now: () => new Date("2020-01-01T00:00:00.000Z"),
      applyRetry,
      reportPermanentFailure,
    });

    await expect(executeJob(jobRow())).resolves.toBeUndefined();

    expect(markSucceeded).not.toHaveBeenCalled();
    expect(applyRetry).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledWith(
      "job-garbage",
      "2020-01-01T00:00:00.000Z",
      'unexpected job handler result: {"status":"wat"}',
    );
    expect(reportPermanentFailure).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job-garbage" }),
      'unexpected job handler result: {"status":"wat"}',
      1,
    );
  });
});
