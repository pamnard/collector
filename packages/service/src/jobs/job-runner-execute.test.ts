import { describe, expect, it, vi } from "vitest";
import { defineJobType, testNoopJobType } from "@collector/shared";
import { z } from "zod";
import { createJobRegistry } from "./job-registry.js";
import { createExecuteJob } from "./job-runner-execute.js";
import type { JobRow } from "./job-store-types.js";

function baseJob(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: "job-1",
    type: "__test_noop",
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

describe("createExecuteJob (#798 / #793 seam)", () => {
  const now = () => new Date("2020-01-01T00:00:00.000Z");

  it("marks failed and reports permanent failure when no handler is registered", async () => {
    const markFailed = vi.fn(async () => undefined);
    const reportPermanentFailure = vi.fn();
    const applyRetry = vi.fn(async () => undefined);
    const registry = createJobRegistry([testNoopJobType]);
    // Catalog knows the type but no handler — executeJob uses has()/requireEntry.

    const executeJob = createExecuteJob({
      store: { markFailed } as never,
      registry,
      timeoutMs: 1000,
      now,
      applyRetry,
      reportPermanentFailure,
    });

    await executeJob(baseJob());

    expect(markFailed).toHaveBeenCalledWith(
      "job-1",
      "2020-01-01T00:00:00.000Z",
      "no handler registered for job type: __test_noop",
    );
    expect(reportPermanentFailure).toHaveBeenCalledOnce();
    expect(applyRetry).not.toHaveBeenCalled();
  });

  it("marks failed on invalid payload_json", async () => {
    const markFailed = vi.fn(async () => undefined);
    const reportPermanentFailure = vi.fn();
    const registry = createJobRegistry([testNoopJobType]);
    registry.register(testNoopJobType, async () => ({ status: "ok" }));

    const executeJob = createExecuteJob({
      store: { markFailed } as never,
      registry,
      timeoutMs: 1000,
      now,
      applyRetry: vi.fn(async () => undefined),
      reportPermanentFailure,
    });

    await executeJob(baseJob({ payload_json: "{not-json" }));

    expect(markFailed).toHaveBeenCalledOnce();
    expect(markFailed.mock.calls[0]![2]).toMatch(/^invalid payload_json:/);
    expect(reportPermanentFailure).toHaveBeenCalledOnce();
  });

  it("marks failed on schema-invalid payload without calling the handler", async () => {
    const markFailed = vi.fn(async () => undefined);
    const reportPermanentFailure = vi.fn();
    const handler = vi.fn(async () => ({ status: "ok" as const }));
    const registry = createJobRegistry([testNoopJobType]);
    registry.register(testNoopJobType, handler);

    const executeJob = createExecuteJob({
      store: { markFailed } as never,
      registry,
      timeoutMs: 1000,
      now,
      applyRetry: vi.fn(async () => undefined),
      reportPermanentFailure,
    });

    await executeJob(baseJob({ payload_json: JSON.stringify({ fail: 1 }) }));

    expect(handler).not.toHaveBeenCalled();
    expect(markFailed.mock.calls[0]![2]).toMatch(/^invalid job payload:/);
    expect(reportPermanentFailure).toHaveBeenCalledOnce();
  });

  it("marks succeeded on ok result", async () => {
    const markSucceeded = vi.fn(async () => undefined);
    const registry = createJobRegistry([testNoopJobType]);
    registry.register(testNoopJobType, async () => ({ status: "ok" }));

    const executeJob = createExecuteJob({
      store: { markSucceeded } as never,
      registry,
      timeoutMs: 1000,
      now,
      applyRetry: vi.fn(async () => undefined),
      reportPermanentFailure: vi.fn(),
    });

    await executeJob(baseJob());

    expect(markSucceeded).toHaveBeenCalledWith(
      "job-1",
      "2020-01-01T00:00:00.000Z",
    );
  });

  it("marks failed permanently when handler returns non-retryable fail", async () => {
    const markFailed = vi.fn(async () => undefined);
    const reportPermanentFailure = vi.fn();
    const registry = createJobRegistry([testNoopJobType]);
    registry.register(testNoopJobType, async () => ({
      status: "fail",
      retryable: false,
      error: "hard fail",
    }));

    const executeJob = createExecuteJob({
      store: { markFailed } as never,
      registry,
      timeoutMs: 1000,
      now,
      applyRetry: vi.fn(async () => undefined),
      reportPermanentFailure,
    });

    await executeJob(baseJob());

    expect(markFailed).toHaveBeenCalledWith(
      "job-1",
      "2020-01-01T00:00:00.000Z",
      "hard fail",
    );
    expect(reportPermanentFailure).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job-1" }),
      "hard fail",
      1,
    );
  });

  it("applies retry without burning attempt when retryAfterMs is set", async () => {
    const applyRetry = vi.fn(async () => undefined);
    const registry = createJobRegistry([testNoopJobType]);
    registry.register(testNoopJobType, async () => ({
      status: "fail",
      retryable: true,
      error: "later",
      retryAfterMs: 5_000,
    }));

    const executeJob = createExecuteJob({
      store: {} as never,
      registry,
      timeoutMs: 1000,
      now,
      applyRetry,
      reportPermanentFailure: vi.fn(),
    });

    await executeJob(baseJob());

    expect(applyRetry).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job-1" }),
      "later",
      {
        availableAt: "2020-01-01T00:00:05.000Z",
        burnAttempt: false,
        retryAfterMs: 5_000,
      },
    );
  });

  it("burns attempt on retryable fail without retryAfterMs", async () => {
    const applyRetry = vi.fn(async () => undefined);
    const registry = createJobRegistry([testNoopJobType]);
    registry.register(testNoopJobType, async () => ({
      status: "fail",
      retryable: true,
      error: "flaky",
    }));

    const executeJob = createExecuteJob({
      store: {} as never,
      registry,
      timeoutMs: 1000,
      now,
      applyRetry,
      reportPermanentFailure: vi.fn(),
    });

    await executeJob(baseJob());

    expect(applyRetry).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job-1" }),
      "flaky",
      {
        availableAt: "2020-01-01T00:00:00.000Z",
        burnAttempt: true,
      },
    );
  });

  it("uses per-type timeoutMs instead of the queue default", async () => {
    vi.useFakeTimers();
    try {
      const slowType = defineJobType({
        id: "__test_slow_timeout",
        payload: z.object({}),
        timeoutMs: 80,
      });
      const applyRetry = vi.fn(async () => undefined);
      const registry = createJobRegistry([slowType]);
      registry.register(slowType, async () => {
        await new Promise((r) => setTimeout(r, 200));
        return { status: "ok" };
      });

      const executeJob = createExecuteJob({
        store: {} as never,
        registry,
        timeoutMs: 5_000,
        now,
        applyRetry,
        reportPermanentFailure: vi.fn(),
      });

      const done = executeJob(
        baseJob({ type: "__test_slow_timeout", payload_json: "{}" }),
      );
      await vi.advanceTimersByTimeAsync(80);
      await done;

      expect(applyRetry).toHaveBeenCalledWith(
        expect.objectContaining({ type: "__test_slow_timeout" }),
        expect.stringMatching(/timed out after 80ms/),
        expect.objectContaining({ burnAttempt: true }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
