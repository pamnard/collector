import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resetIndexSchema,
  runJobsMigrations,
  runMigrations,
} from "@collector/db";
import { NodeSqliteExecutor } from "../host/node-sql.js";
import { createJobQueue, testNoopHandler } from "./job-queue.js";

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

describe("createJobQueue (#628)", () => {
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
      handlers: { __test_noop: testNoopHandler },
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
    });

    await queue.stop();
  });

  it("burns attempt on retryable fail without retryAfterMs", async () => {
    const dbPath = tempJobsPath();
    let calls = 0;
    const queue = await createJobQueue({
      dbPath,
      handlers: {
        flaky: async () => {
          calls += 1;
          if (calls < 3) {
            return {
              status: "fail",
              retryable: true,
              error: "try again",
            };
          }
          return { status: "ok" };
        },
      },
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
    const queue = await createJobQueue({
      dbPath,
      handlers: {
        gated: async () => {
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
        },
      },
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
    const queue = await createJobQueue({
      dbPath,
      handlers: {
        slow: async () => {
          await gate;
          return { status: "ok" };
        },
      },
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
      handlers: { __test_noop: testNoopHandler },
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
      handlers: { __test_noop: testNoopHandler },
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
      handlers: { __test_noop: testNoopHandler },
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
});
