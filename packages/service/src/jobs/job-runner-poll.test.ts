import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runJobsMigrations } from "@collector/db";
import {
  JOB_PRIORITY_BULK,
  isVaultMutatingBulkJob,
} from "@collector/shared";
import { NodeSqliteExecutor } from "../host/node-sql.js";
import { createJobPoll } from "./job-runner-poll.js";
import { createJobStore, type JobRow, type JobStore } from "./job-store.js";

const NOW = new Date("2020-01-01T00:00:00.000Z");
const NOW_ISO = NOW.toISOString();

describe("createJobPoll", () => {
  const dirs: string[] = [];
  const openSql: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    for (const sql of openSql.splice(0)) {
      await sql.close();
    }
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  async function openRealStore(): Promise<{ store: JobStore }> {
    const dir = mkdtempSync(join(tmpdir(), "collector-job-poll-"));
    dirs.push(dir);
    const sql = await NodeSqliteExecutor.open(join(dir, "jobs.db"));
    openSql.push(sql);
    await runJobsMigrations(sql);
    return { store: createJobStore(sql) };
  }

  async function insertPending(
    store: JobStore,
    input: {
      id: string;
      type: string;
      priority?: number;
      payloadJson?: string;
      createdAt?: string;
    },
  ): Promise<void> {
    const createdAt = input.createdAt ?? NOW_ISO;
    await store.insertJob({
      id: input.id,
      type: input.type,
      payloadJson: input.payloadJson ?? "{}",
      priority: input.priority ?? 0,
      idempotencyKey: null,
      maxAttempts: 3,
      availableAt: NOW_ISO,
      createdAt,
    });
  }

  it("returns claimed job to pending when stop happens before execute", async () => {
    const { store } = await openRealStore();
    await insertPending(store, { id: "job-1", type: "__test_noop" });

    let stopped = false;
    const executeJob = vi.fn(async () => undefined);
    const pollStore: JobStore = {
      ...store,
      claimNext: async (nowIso, options) => {
        const job = await store.claimNext(nowIso, options);
        if (job) {
          // Simulate stop arriving while claimNext was awaited.
          stopped = true;
        }
        return job;
      },
    };

    const poll = createJobPoll({
      store: pollStore,
      concurrency: 1,
      pollIntervalMs: 1000,
      now: () => NOW,
      executeJob,
      isStopped: () => stopped,
    });

    await poll.runTick();
    poll.clearPollTimer();

    expect(executeJob).not.toHaveBeenCalled();
    const row = await store.getJob("job-1");
    expect(row).toMatchObject({
      id: "job-1",
      status: "pending",
      started_at: null,
    });
  });

  it("skips claiming vault-mutating bulk jobs while one is already in flight", async () => {
    const { store } = await openRealStore();
    await insertPending(store, {
      id: "bulk-a",
      type: "vaultIndexSync",
      priority: JOB_PRIORITY_BULK,
      payloadJson: JSON.stringify({
        vaultId: "v1",
        vaultPath: "/v",
        reason: "kickoff",
      }),
      createdAt: "2020-01-01T00:00:00.000Z",
    });
    await insertPending(store, {
      id: "bulk-b",
      type: "vaultIndexSync",
      priority: JOB_PRIORITY_BULK,
      payloadJson: JSON.stringify({
        vaultId: "v1",
        vaultPath: "/v",
        reason: "kickoff",
      }),
      createdAt: "2020-01-01T00:00:01.000Z",
    });
    await insertPending(store, {
      id: "light-1",
      type: "__test_noop",
      priority: JOB_PRIORITY_BULK,
      createdAt: "2020-01-01T00:00:02.000Z",
    });

    const started: string[] = [];
    let resolveBulk: (() => void) | undefined;
    const bulkGate = new Promise<void>((resolve) => {
      resolveBulk = resolve;
    });
    const executeJob = vi.fn(async (job: JobRow) => {
      started.push(job.id);
      if (isVaultMutatingBulkJob(job)) {
        await bulkGate;
      }
    });

    let stopped = false;
    const poll = createJobPoll({
      store,
      concurrency: 2,
      pollIntervalMs: 1000,
      now: () => NOW,
      executeJob,
      isStopped: () => stopped,
    });

    try {
      await poll.runTick();
      // claimed>0 && inFlight < concurrency arms schedulePoll(0); disarm before asserts.
      stopped = true;
      poll.clearPollTimer();

      expect(started).toEqual(["bulk-a", "light-1"]);
      expect(executeJob).toHaveBeenCalledTimes(2);

      expect(await store.getJob("bulk-a")).toMatchObject({
        status: "running",
      });
      expect(await store.getJob("bulk-b")).toMatchObject({
        status: "pending",
        started_at: null,
      });
      expect(await store.getJob("light-1")).toMatchObject({
        status: "running",
      });
      expect(await store.stats()).toMatchObject({
        pending: 1,
        running: 2,
      });
    } finally {
      stopped = true;
      poll.clearPollTimer();
      resolveBulk?.();
      await poll.waitForIdle();
    }
  });

  it("wake is a no-op after stop", async () => {
    const { store } = await openRealStore();
    let stopped = false;
    const executeJob = vi.fn(async () => undefined);
    const claimSpy = vi.spyOn(store, "claimNext");

    const poll = createJobPoll({
      store,
      concurrency: 1,
      pollIntervalMs: 50,
      now: () => NOW,
      executeJob,
      isStopped: () => stopped,
    });

    await poll.runTick();
    expect(claimSpy).toHaveBeenCalledOnce();
    stopped = true;
    poll.clearPollTimer();
    poll.wake();
    expect(claimSpy).toHaveBeenCalledOnce();
    expect(await store.stats()).toMatchObject({
      pending: 0,
      running: 0,
    });
  });
});
