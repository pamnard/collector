import { describe, expect, it, vi } from "vitest";
import { createApplyRetry } from "./job-runner-retry.js";
import type { JobRow } from "./job-store-types.js";

function jobRow(): JobRow {
  return {
    id: "job-1",
    type: "__test_noop",
    payload_json: "{}",
    status: "running",
    priority: 0,
    idempotency_key: null,
    attempts: 2,
    max_attempts: 3,
    available_at: "2020-01-01T00:00:00.000Z",
    started_at: "2020-01-01T00:00:00.000Z",
    finished_at: null,
    last_error: null,
    created_at: "2020-01-01T00:00:00.000Z",
    updated_at: "2020-01-01T00:00:00.000Z",
  };
}

describe("createApplyRetry (#798 / #793 seam)", () => {
  const now = () => new Date("2020-01-01T12:00:00.000Z");

  it("reports permanent failure when scheduleRetry settles as failed", async () => {
    const scheduleRetry = vi.fn(async () => ({
      status: "failed" as const,
      attempts: 3,
    }));
    const reportPermanentFailure = vi.fn();
    const applyRetry = createApplyRetry({
      store: { scheduleRetry } as never,
      now,
      reportPermanentFailure,
    });

    await applyRetry(jobRow(), "boom", {
      availableAt: "2020-01-01T12:00:00.000Z",
      burnAttempt: true,
    });

    expect(scheduleRetry).toHaveBeenCalledWith({
      id: "job-1",
      nowIso: "2020-01-01T12:00:00.000Z",
      availableAt: "2020-01-01T12:00:00.000Z",
      error: "boom",
      burnAttempt: true,
    });
    expect(reportPermanentFailure).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job-1" }),
      "boom",
      3,
    );
  });

  it("does not report permanent failure when a retry is scheduled", async () => {
    const scheduleRetry = vi.fn(async () => ({
      status: "pending" as const,
      attempts: 2,
    }));
    const reportPermanentFailure = vi.fn();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const applyRetry = createApplyRetry({
      store: { scheduleRetry } as never,
      now,
      reportPermanentFailure,
    });

    await applyRetry(jobRow(), "transient", {
      availableAt: "2020-01-01T12:00:05.000Z",
      burnAttempt: false,
      retryAfterMs: 5_000,
    });

    expect(reportPermanentFailure).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      "[jobs] retry scheduled",
      expect.objectContaining({
        jobId: "job-1",
        retryAfterMs: 5_000,
      }),
    );
    info.mockRestore();
  });
});
