import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  resetIndexSchema,
  runJobsMigrations,
  runMigrations,
} from "@collector/db";
import { defineJobType, testNoopJobType } from "@collector/shared";
import { NodeSqliteExecutor } from "../host/node-sql.js";
import {
  createJobQueue,
  createHostJobRegistry,
} from "./job-queue.js";
import { createJobRegistry } from "./job-registry.js";
import { createJobRunner } from "./job-runner.js";
import { createJobStore } from "./job-store.js";

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("waitFor timed out");
}

describe("createJobQueue (#628 / #629)", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempJobsPath(): string {
    const dir = mkdtempSync(join(tmpdir(), "collector-jobs-queue-"));
    dirs.push(dir);
    return join(dir, "jobs.db");
  }

  it("runs noop to succeeded and reports stats", async () => {
    const dbPath = tempJobsPath();
    const queue = await createJobQueue({
      dbPath,
      registry: createHostJobRegistry(),
      pollIntervalMs: 20,
      timeoutMs: 1000,
    });
    queue.start();

    const { id, deduped } = await queue.enqueue({ type: "__test_noop" });
    expect(deduped).toBe(false);
    expect(id).toBeTruthy();

    await waitFor(async () => (await queue.stats()).succeeded === 1);
    expect(await queue.stats()).toMatchObject({
      pending: 0,
      running: 0,
      succeeded: 1,
      failed: 0,
      byType: {
        __test_noop: {
          pending: 0,
          running: 0,
          succeeded: 1,
          failed: 0,
          cancelled: 0,
        },
      },
    });

    await queue.stop();
  });

  it("burns attempt on retryable fail without retryAfterMs", async () => {
    const dbPath = tempJobsPath();
    let calls = 0;
    const flaky = defineJobType({
      id: "flaky",
      payload: z.object({}),
    });
    const registry = createJobRegistry([flaky]);
    registry.register(flaky, async () => {
      calls += 1;
      if (calls < 3) {
        return {
          status: "fail",
          retryable: true,
          error: "try again",
        };
      }
      return { status: "ok" };
    });
    const queue = await createJobQueue({
      dbPath,
      registry,
      pollIntervalMs: 20,
      timeoutMs: 1000,
    });
    queue.start();

    await queue.enqueue({ type: "flaky", maxAttempts: 3 });
    await waitFor(async () => (await queue.stats()).succeeded === 1);
    expect(calls).toBe(3);
    await queue.stop();
  });

  it("RetryAfter does not burn an attempt", async () => {
    const dbPath = tempJobsPath();
    let calls = 0;
    const gated = defineJobType({
      id: "gated",
      payload: z.object({}),
    });
    const registry = createJobRegistry([gated]);
    registry.register(gated, async () => {
      calls += 1;
      if (calls === 1) {
        return {
          status: "fail",
          retryable: true,
          error: "wait",
          retryAfterMs: 30,
        };
      }
      return { status: "ok" };
    });
    const queue = await createJobQueue({
      dbPath,
      registry,
      pollIntervalMs: 15,
      timeoutMs: 1000,
    });
    queue.start();

    await queue.enqueue({ type: "gated", maxAttempts: 1 });
    await waitFor(async () => (await queue.stats()).succeeded === 1);
    expect(calls).toBe(2);
    expect(await queue.stats()).toMatchObject({ failed: 0, succeeded: 1 });
    await queue.stop();
  });

  it("dedupes pending/running by idempotencyKey", async () => {
    const dbPath = tempJobsPath();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = defineJobType({
      id: "slow",
      payload: z.object({}),
    });
    const registry = createJobRegistry([slow]);
    registry.register(slow, async () => {
      await gate;
      return { status: "ok" };
    });
    const queue = await createJobQueue({
      dbPath,
      registry,
      concurrency: 1,
      pollIntervalMs: 20,
      timeoutMs: 5000,
    });
    queue.start();

    const first = await queue.enqueue({
      type: "slow",
      idempotencyKey: "k1",
    });
    await waitFor(async () => (await queue.stats()).running === 1);
    const second = await queue.enqueue({
      type: "slow",
      idempotencyKey: "k1",
    });
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);

    release();
    await waitFor(async () => (await queue.stats()).succeeded === 1);
    await queue.stop();
  });

  it("survives stop/reopen with pending jobs", async () => {
    const dbPath = tempJobsPath();
    const queue1 = await createJobQueue({
      dbPath,
      registry: createHostJobRegistry(),
      pollIntervalMs: 20,
    });
    // enqueue without start so job stays pending
    const { id } = await queue1.enqueue({
      type: "__test_noop",
      delayMs: 0,
    });
    expect((await queue1.stats()).pending).toBe(1);
    await queue1.stop();

    const queue2 = await createJobQueue({
      dbPath,
      registry: createHostJobRegistry(),
      pollIntervalMs: 20,
    });
    expect((await queue2.stats()).pending).toBe(1);
    queue2.start();
    await waitFor(async () => (await queue2.stats()).succeeded === 1);
    const sql = NodeSqliteExecutor.open(dbPath);
    const rows = await sql.select<{ id: string; status: string }>(
      "SELECT id, status FROM jobs WHERE id = ?",
      [id],
    );
    expect(rows[0]?.status).toBe("succeeded");
    await sql.close();
    await queue2.stop();
  });

  it("reclaims running jobs after crash-style reopen (#640)", async () => {
    const dbPath = tempJobsPath();
    const sql = NodeSqliteExecutor.open(dbPath);
    await runJobsMigrations(sql);
    await sql.execute(
      `INSERT INTO jobs (
         id, type, payload_json, status, priority, idempotency_key,
         attempts, max_attempts, available_at, started_at, created_at, updated_at
       ) VALUES (
         'orphan-running', '__test_noop', '{}', 'running', 0, NULL,
         1, 3, datetime('now'), datetime('now'), datetime('now'), datetime('now')
       )`,
    );
    await sql.close();

    const queue = await createJobQueue({
      dbPath,
      registry: createHostJobRegistry(),
      pollIntervalMs: 20,
      timeoutMs: 1000,
    });
    expect(await queue.stats()).toMatchObject({
      running: 1,
      pending: 0,
      succeeded: 0,
    });
    queue.start();
    await waitFor(async () => (await queue.stats()).succeeded === 1);
    expect(await queue.stats()).toMatchObject({
      running: 0,
      pending: 0,
      succeeded: 1,
      failed: 0,
    });
    await queue.stop();
  });

  it("index reset does not touch jobs.db", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-jobs-vs-index-"));
    dirs.push(dir);
    const jobsPath = join(dir, "jobs.db");
    const indexPath = join(dir, "collector.db");

    const jobsSql = NodeSqliteExecutor.open(jobsPath);
    await runJobsMigrations(jobsSql);
    await jobsSql.execute(
      `INSERT INTO jobs (
         id, type, payload_json, status, priority, idempotency_key,
         attempts, max_attempts, available_at, created_at, updated_at
       ) VALUES ('j1', 't', '{}', 'pending', 0, NULL, 0, 3, datetime('now'), datetime('now'), datetime('now'))`,
    );
    await jobsSql.close();

    const indexSql = NodeSqliteExecutor.open(indexPath);
    await runMigrations(indexSql);
    await resetIndexSchema(indexSql);
    await runMigrations(indexSql);
    await indexSql.close();

    const jobsAgain = NodeSqliteExecutor.open(jobsPath);
    const rows = await jobsAgain.select<{ id: string }>(
      "SELECT id FROM jobs WHERE id = 'j1'",
    );
    expect(rows).toEqual([{ id: "j1" }]);
    await jobsAgain.close();
  });

  it("cancel removes pending job only", async () => {
    const dbPath = tempJobsPath();
    const queue = await createJobQueue({
      dbPath,
      registry: createHostJobRegistry(),
    });
    const { id } = await queue.enqueue({
      type: "__test_noop",
      delayMs: 60_000,
    });
    expect(await queue.cancel(id)).toBe(true);
    expect(await queue.cancel(id)).toBe(false);
    expect(await queue.stats()).toMatchObject({ cancelled: 1, pending: 0 });
    await queue.stop();
  });

  it("rejects unknown job type on enqueue (#629)", async () => {
    const dbPath = tempJobsPath();
    const queue = await createJobQueue({
      dbPath,
      registry: createHostJobRegistry(),
    });
    await expect(
      queue.enqueue({ type: "not_a_real_type" }),
    ).rejects.toThrow(/unknown job type/i);
    expect(await queue.stats()).toMatchObject({
      pending: 0,
      succeeded: 0,
      failed: 0,
    });
    await queue.stop();
  });

  it("rejects invalid payload on enqueue (#629)", async () => {
    const dbPath = tempJobsPath();
    const queue = await createJobQueue({
      dbPath,
      registry: createHostJobRegistry(),
    });
    await expect(
      queue.enqueue({
        type: "__test_noop",
        payload: { fail: "nope" },
      }),
    ).rejects.toThrow();
    expect(await queue.stats()).toMatchObject({ pending: 0, failed: 0 });
    await queue.stop();
  });

  it("marks failed without calling handler on invalid stored payload (#629)", async () => {
    const dbPath = tempJobsPath();
    let calls = 0;
    const registry = createJobRegistry([testNoopJobType]);
    registry.register(testNoopJobType, async () => {
      calls += 1;
      return { status: "ok" };
    });

    const sql = NodeSqliteExecutor.open(dbPath);
    await runJobsMigrations(sql);
    const store = createJobStore(sql);
    await store.insertJob({
      id: "bad1",
      type: "__test_noop",
      payloadJson: JSON.stringify({ fail: 1 }),
      priority: 0,
      idempotencyKey: null,
      maxAttempts: 3,
      availableAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    const runner = createJobRunner({
      store,
      registry,
      concurrency: 1,
      timeoutMs: 1000,
      pollIntervalMs: 20,
      now: () => new Date(),
    });
    runner.start();
    await waitFor(async () => (await store.stats()).failed === 1);
    expect(calls).toBe(0);
    await runner.stop();
    await sql.close();
  });

  it("invokes onPermanentFailure once for permanent fail (#630)", async () => {
    const dbPath = tempJobsPath();
    const failures: Array<{
      id: string;
      type: string;
      error: string;
      attempts: number;
    }> = [];
    const queue = await createJobQueue({
      dbPath,
      registry: createHostJobRegistry(),
      pollIntervalMs: 20,
      timeoutMs: 1000,
      onPermanentFailure: (info) => {
        failures.push(info);
      },
    });
    queue.start();

    const { id } = await queue.enqueue({
      type: "__test_noop",
      payload: { fail: "permanent" },
    });
    await waitFor(async () => (await queue.stats()).failed === 1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      id,
      type: "__test_noop",
      error: "noop permanent fail",
    });
    await queue.stop();
  });

  it("invokes onPermanentFailure when retries are exhausted (#630)", async () => {
    const dbPath = tempJobsPath();
    const failures: Array<{ id: string; type: string }> = [];
    let calls = 0;
    const flaky = defineJobType({
      id: "exhaust",
      payload: z.object({}),
    });
    const registry = createJobRegistry([flaky]);
    registry.register(flaky, async () => {
      calls += 1;
      return {
        status: "fail",
        retryable: true,
        error: "still failing",
      };
    });
    const queue = await createJobQueue({
      dbPath,
      registry,
      pollIntervalMs: 20,
      timeoutMs: 1000,
      onPermanentFailure: (info) => {
        failures.push(info);
      },
    });
    queue.start();

    await queue.enqueue({ type: "exhaust", maxAttempts: 2 });
    await waitFor(async () => (await queue.stats()).failed === 1);
    expect(calls).toBe(2);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.type).toBe("exhaust");
    expect(failures[0]?.attempts).toBe(2);
    await queue.stop();
  });

  it("uses per-type timeoutMs instead of the queue default (#747)", async () => {
    const dbPath = tempJobsPath();
    const long = defineJobType({
      id: "long-type",
      payload: z.object({}),
      timeoutMs: 2_000,
    });
    const registry = createJobRegistry([long]);
    registry.register(long, async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { status: "ok" };
    });
    const queue = await createJobQueue({
      dbPath,
      registry,
      pollIntervalMs: 20,
      // Would fail the 150ms handler if used instead of the type timeout.
      timeoutMs: 40,
    });
    queue.start();

    await queue.enqueue({ type: "long-type" });
    await waitFor(async () => (await queue.stats()).succeeded === 1);
    await queue.stop();
  });

  it("uses per-type maxAttempts when enqueue omits it (#747)", async () => {
    const dbPath = tempJobsPath();
    let calls = 0;
    const once = defineJobType({
      id: "once-type",
      payload: z.object({}),
      maxAttempts: 1,
    });
    const registry = createJobRegistry([once]);
    registry.register(once, async () => {
      calls += 1;
      return { status: "fail", retryable: true, error: "retry me" };
    });
    const queue = await createJobQueue({
      dbPath,
      registry,
      pollIntervalMs: 20,
      timeoutMs: 1000,
    });
    queue.start();

    const { id } = await queue.enqueue({ type: "once-type" });
    await waitFor(async () => (await queue.stats()).failed === 1);
    const row = await queue.getJob(id);
    expect(row?.max_attempts).toBe(1);
    expect(calls).toBe(1);
    await queue.stop();
  });

  it("does not invoke onPermanentFailure for transient retry (#630)", async () => {
    const dbPath = tempJobsPath();
    const failures: unknown[] = [];
    let calls = 0;
    const flaky = defineJobType({
      id: "recover",
      payload: z.object({}),
    });
    const registry = createJobRegistry([flaky]);
    registry.register(flaky, async () => {
      calls += 1;
      if (calls < 2) {
        return {
          status: "fail",
          retryable: true,
          error: "try again",
        };
      }
      return { status: "ok" };
    });
    const queue = await createJobQueue({
      dbPath,
      registry,
      pollIntervalMs: 20,
      timeoutMs: 1000,
      onPermanentFailure: (info) => {
        failures.push(info);
      },
    });
    queue.start();

    await queue.enqueue({ type: "recover", maxAttempts: 3 });
    await waitFor(async () => (await queue.stats()).succeeded === 1);
    expect(failures).toHaveLength(0);
    await queue.stop();
  });
});
