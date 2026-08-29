import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runJobsMigrations } from "@collector/db";
import { NodeSqliteExecutor } from "../host/node-sql.js";
import { createApplyRetry } from "./job-runner-retry.js";
import { createJobStore, type JobRow, type JobStore } from "./job-store.js";

const FIXED_NOW = new Date("2020-01-01T12:00:00.000Z");
const FIXED_NOW_ISO = FIXED_NOW.toISOString();

describe("createApplyRetry (#798 / #793 seam)", () => {
  const dirs: string[] = [];
  const executors: NodeSqliteExecutor[] = [];

  afterEach(async () => {
    for (const sql of executors.splice(0)) {
      await sql.close();
    }
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  async function openStore(): Promise<JobStore> {
    const dir = mkdtempSync(join(tmpdir(), "collector-jobs-retry-"));
    dirs.push(dir);
    const sql = await NodeSqliteExecutor.open(join(dir, "jobs.db"));
    executors.push(sql);
    await runJobsMigrations(sql);
    return createJobStore(sql);
  }

  async function insertAndClaim(
    store: JobStore,
    overrides: { id?: string; maxAttempts?: number } = {},
  ): Promise<JobRow> {
    const id = overrides.id ?? "job-1";
    await store.insertJob({
      id,
      type: "__test_noop",
      payloadJson: "{}",
      priority: 0,
      idempotencyKey: null,
      maxAttempts: overrides.maxAttempts ?? 3,
      availableAt: "2020-01-01T00:00:00.000Z",
      createdAt: "2020-01-01T00:00:00.000Z",
    });
    const claimed = await store.claimNext("2020-01-01T00:00:00.000Z");
    if (!claimed || claimed.id !== id) {
      throw new Error(`expected claim of ${id}`);
    }
    return claimed;
  }

  it("writes failed row and reports permanent failure when attempts are exhausted", async () => {
    const store = await openStore();
    const permanentFailures: Array<{
      id: string;
      error: string;
      attempts: number;
    }> = [];
    const applyRetry = createApplyRetry({
      store,
      now: () => FIXED_NOW,
      reportPermanentFailure: (job, error, attempts) => {
        permanentFailures.push({ id: job.id, error, attempts });
      },
    });

    const job = await insertAndClaim(store, { maxAttempts: 1 });
    expect(job.attempts).toBe(0);

    await applyRetry(job, "boom", {
      availableAt: FIXED_NOW_ISO,
      burnAttempt: true,
    });

    const row = await store.getJob(job.id);
    if (!row) {
      throw new Error("job missing after applyRetry");
    }
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(1);
    expect(row.last_error).toBe("boom");
    expect(row.finished_at).toBe(FIXED_NOW_ISO);
    expect(permanentFailures).toEqual([
      { id: "job-1", error: "boom", attempts: 1 },
    ]);
  });

  it("reschedules pending without permanent failure when attempts remain", async () => {
    const store = await openStore();
    const permanentFailures: unknown[] = [];
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const applyRetry = createApplyRetry({
      store,
      now: () => FIXED_NOW,
      reportPermanentFailure: (job, error, attempts) => {
        permanentFailures.push({ id: job.id, error, attempts });
      },
    });

    const job = await insertAndClaim(store, { maxAttempts: 3 });
    const availableAt = "2020-01-01T12:00:05.000Z";

    await applyRetry(job, "transient", {
      availableAt,
      burnAttempt: false,
      retryAfterMs: 5_000,
    });

    const row = await store.getJob(job.id);
    if (!row) {
      throw new Error("job missing after applyRetry");
    }
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(0);
    expect(row.last_error).toBe("transient");
    expect(row.available_at).toBe(availableAt);
    expect(row.started_at).toBeNull();
    expect(row.finished_at).toBeNull();
    expect(permanentFailures).toEqual([]);
    expect(info).toHaveBeenCalledWith(
      "[jobs] retry scheduled",
      expect.objectContaining({
        jobId: "job-1",
        retryAfterMs: 5_000,
      }),
    );
    info.mockRestore();
  });

  it("burns an attempt on retryable reschedule when burnAttempt is true", async () => {
    const store = await openStore();
    const applyRetry = createApplyRetry({
      store,
      now: () => FIXED_NOW,
      reportPermanentFailure: () => {
        throw new Error("should not permanent-fail");
      },
    });

    const job = await insertAndClaim(store, { maxAttempts: 3 });
    await applyRetry(job, "flaky", {
      availableAt: "2020-01-01T12:00:05.000Z",
      burnAttempt: true,
    });

    const row = await store.getJob(job.id);
    if (!row) {
      throw new Error("job missing after applyRetry");
    }
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.last_error).toBe("flaky");
    expect(row.available_at).toBe("2020-01-01T12:00:05.000Z");
  });
});
