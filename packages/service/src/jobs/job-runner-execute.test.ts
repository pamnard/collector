import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runJobsMigrations } from "@collector/db";
import { defineJobType, testNoopJobType } from "@collector/shared";
import { z } from "zod";
import { NodeSqliteExecutor } from "../host/node-sql.js";
import { createJobRegistry } from "./job-registry.js";
import { createExecuteJob } from "./job-runner-execute.js";
import { createApplyRetry } from "./job-runner-retry.js";
import { createJobStore, type JobRow, type JobStore } from "./job-store.js";

const FIXED_NOW = new Date("2020-01-01T00:00:00.000Z");
const FIXED_NOW_ISO = FIXED_NOW.toISOString();

describe("createExecuteJob (#798 / #793 seam)", () => {
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
    const dir = mkdtempSync(join(tmpdir(), "collector-jobs-execute-"));
    dirs.push(dir);
    const sql = await NodeSqliteExecutor.open(join(dir, "jobs.db"));
    executors.push(sql);
    await runJobsMigrations(sql);
    return createJobStore(sql);
  }

  async function insertAndClaim(
    store: JobStore,
    overrides: {
      id?: string;
      type?: string;
      payloadJson?: string;
      maxAttempts?: number;
    } = {},
  ): Promise<JobRow> {
    const id = overrides.id ?? "job-1";
    await store.insertJob({
      id,
      type: overrides.type ?? "__test_noop",
      payloadJson: overrides.payloadJson ?? "{}",
      priority: 0,
      idempotencyKey: null,
      maxAttempts: overrides.maxAttempts ?? 3,
      availableAt: FIXED_NOW_ISO,
      createdAt: FIXED_NOW_ISO,
    });
    const claimed = await store.claimNext(FIXED_NOW_ISO);
    if (!claimed || claimed.id !== id) {
      throw new Error(`expected claim of ${id}`);
    }
    return claimed;
  }

  function wireExecute(store: JobStore, registry: ReturnType<typeof createJobRegistry>) {
    const permanentFailures: Array<{
      id: string;
      type: string;
      error: string;
      attempts: number;
    }> = [];
    const reportPermanentFailure = (
      job: JobRow,
      error: string,
      attempts: number,
    ) => {
      permanentFailures.push({
        id: job.id,
        type: job.type,
        error,
        attempts,
      });
    };
    const applyRetry = createApplyRetry({
      store,
      now: () => FIXED_NOW,
      reportPermanentFailure,
    });
    const executeJob = createExecuteJob({
      store,
      registry,
      timeoutMs: 1000,
      now: () => FIXED_NOW,
      applyRetry,
      reportPermanentFailure,
    });
    return { executeJob, permanentFailures };
  }

  it("marks failed permanently when no handler is registered", async () => {
    const store = await openStore();
    const registry = createJobRegistry([testNoopJobType]);
    const { executeJob, permanentFailures } = wireExecute(store, registry);
    const job = await insertAndClaim(store);

    await executeJob(job);

    const row = await store.getJob(job.id);
    if (!row) {
      throw new Error("job missing after execute");
    }
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(0);
    expect(row.last_error).toBe(
      "no handler registered for job type: __test_noop",
    );
    expect(row.finished_at).toBe(FIXED_NOW_ISO);
    expect(permanentFailures).toEqual([
      {
        id: job.id,
        type: "__test_noop",
        error: "no handler registered for job type: __test_noop",
        attempts: 0,
      },
    ]);
  });

  it("marks failed on invalid payload_json", async () => {
    const store = await openStore();
    const registry = createJobRegistry([testNoopJobType]);
    registry.register(testNoopJobType, async () => ({ status: "ok" }));
    const { executeJob, permanentFailures } = wireExecute(store, registry);
    const job = await insertAndClaim(store, { payloadJson: "{not-json" });

    await executeJob(job);

    const row = await store.getJob(job.id);
    if (!row) {
      throw new Error("job missing after execute");
    }
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(0);
    expect(row.last_error).toMatch(/^invalid payload_json:/);
    expect(permanentFailures).toHaveLength(1);
    expect(permanentFailures[0]?.error).toMatch(/^invalid payload_json:/);
  });

  it("marks failed on schema-invalid payload without calling the handler", async () => {
    const store = await openStore();
    let handlerCalls = 0;
    const registry = createJobRegistry([testNoopJobType]);
    registry.register(testNoopJobType, async () => {
      handlerCalls += 1;
      return { status: "ok" };
    });
    const { executeJob, permanentFailures } = wireExecute(store, registry);
    const job = await insertAndClaim(store, {
      payloadJson: JSON.stringify({ fail: 1 }),
    });

    await executeJob(job);

    expect(handlerCalls).toBe(0);
    const row = await store.getJob(job.id);
    if (!row) {
      throw new Error("job missing after execute");
    }
    expect(row.status).toBe("failed");
    expect(row.last_error).toMatch(/^invalid job payload:/);
    expect(permanentFailures).toHaveLength(1);
  });

  it("marks succeeded on ok result", async () => {
    const store = await openStore();
    const registry = createJobRegistry([testNoopJobType]);
    registry.register(testNoopJobType, async () => ({ status: "ok" }));
    const { executeJob, permanentFailures } = wireExecute(store, registry);
    const job = await insertAndClaim(store);

    await executeJob(job);

    const row = await store.getJob(job.id);
    if (!row) {
      throw new Error("job missing after execute");
    }
    expect(row.status).toBe("succeeded");
    expect(row.attempts).toBe(0);
    expect(row.last_error).toBeNull();
    expect(row.finished_at).toBe(FIXED_NOW_ISO);
    expect(permanentFailures).toEqual([]);
  });

  it("marks failed permanently when handler returns non-retryable fail", async () => {
    const store = await openStore();
    const registry = createJobRegistry([testNoopJobType]);
    registry.register(testNoopJobType, async () => ({
      status: "fail",
      retryable: false,
      error: "hard fail",
    }));
    const { executeJob, permanentFailures } = wireExecute(store, registry);
    const job = await insertAndClaim(store);

    await executeJob(job);

    const row = await store.getJob(job.id);
    if (!row) {
      throw new Error("job missing after execute");
    }
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(0);
    expect(row.last_error).toBe("hard fail");
    expect(row.finished_at).toBe(FIXED_NOW_ISO);
    expect(permanentFailures).toEqual([
      {
        id: job.id,
        type: "__test_noop",
        error: "hard fail",
        attempts: 0,
      },
    ]);
  });

  it("schedules retry without burning attempt when retryAfterMs is set", async () => {
    const store = await openStore();
    const registry = createJobRegistry([testNoopJobType]);
    registry.register(testNoopJobType, async () => ({
      status: "fail",
      retryable: true,
      error: "later",
      retryAfterMs: 5_000,
    }));
    const { executeJob, permanentFailures } = wireExecute(store, registry);
    const job = await insertAndClaim(store);

    await executeJob(job);

    const row = await store.getJob(job.id);
    if (!row) {
      throw new Error("job missing after execute");
    }
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(0);
    expect(row.last_error).toBe("later");
    expect(row.available_at).toBe("2020-01-01T00:00:05.000Z");
    expect(row.started_at).toBeNull();
    expect(row.finished_at).toBeNull();
    expect(permanentFailures).toEqual([]);
  });

  it("burns attempt on retryable fail without retryAfterMs", async () => {
    const store = await openStore();
    const registry = createJobRegistry([testNoopJobType]);
    registry.register(testNoopJobType, async () => ({
      status: "fail",
      retryable: true,
      error: "flaky",
    }));
    const { executeJob, permanentFailures } = wireExecute(store, registry);
    const job = await insertAndClaim(store);

    await executeJob(job);

    const row = await store.getJob(job.id);
    if (!row) {
      throw new Error("job missing after execute");
    }
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.last_error).toBe("flaky");
    expect(row.available_at).toBe(FIXED_NOW_ISO);
    expect(row.started_at).toBeNull();
    expect(permanentFailures).toEqual([]);
  });

  it("uses per-type timeoutMs instead of the queue default", async () => {
    const store = await openStore();
    const slowType = defineJobType({
      id: "__test_slow_timeout",
      payload: z.object({}),
      timeoutMs: 80,
    });
    const registry = createJobRegistry([slowType]);
    registry.register(slowType, async () => {
      await new Promise((r) => setTimeout(r, 200));
      return { status: "ok" };
    });
    const { executeJob, permanentFailures } = wireExecute(store, registry);
    const job = await insertAndClaim(store, {
      type: "__test_slow_timeout",
      payloadJson: "{}",
    });

    await executeJob(job);

    const row = await store.getJob(job.id);
    if (!row) {
      throw new Error("job missing after execute");
    }
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.last_error).toMatch(/timed out after 80ms/);
    expect(permanentFailures).toEqual([]);
  });

  it("settles unexpected handler result as permanent failure (does not leave running)", async () => {
    const store = await openStore();
    const registry = createJobRegistry([testNoopJobType]);
    registry.register(testNoopJobType, async () => {
      return { status: "wat" } as never;
    });
    const { executeJob, permanentFailures } = wireExecute(store, registry);
    const job = await insertAndClaim(store);

    await expect(executeJob(job)).resolves.toBeUndefined();

    const row = await store.getJob(job.id);
    if (!row) {
      throw new Error("job missing after execute");
    }
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(0);
    expect(row.last_error).toMatch(/unexpected job handler result/);
    expect(row.finished_at).toBe(FIXED_NOW_ISO);
    expect(permanentFailures).toHaveLength(1);
    expect(permanentFailures[0]?.error).toMatch(/unexpected job handler result/);
  });
});
