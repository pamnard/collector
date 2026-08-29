/**
 * Embedding reconcile scheduler — real index plan + jobs.db enqueue (#886).
 * Green only when planEmbeddingReconcileTick + enqueueRefreshEmbeddings succeed.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_MODEL_ID } from "@collector/core";
import { runMigrations } from "@collector/db";
import { refreshEmbeddingsJobType } from "@collector/shared";
import { BetterSqliteMigrator } from "../../../db/src/testing/better-sqlite.js";
import { enqueueRefreshEmbeddings } from "../jobs/handlers/refresh-embeddings.js";
import { createJobQueue, type JobQueue } from "../jobs/job-queue.js";
import { createJobRegistry } from "../jobs/job-registry.js";
import {
  createEmbeddingReconcileScheduler,
  DEFAULT_EMBEDDING_RECONCILE_BATCH_SIZE,
  DEFAULT_EMBEDDING_RECONCILE_INTERVAL_MS,
  DEFAULT_EMBEDDING_RECONCILE_SCAN_LIMIT,
} from "./embedding-reconcile-scheduler.js";

describe("createEmbeddingReconcileScheduler (#742 / #886)", () => {
  let dataDir = "";
  let db: BetterSqliteMigrator | null = null;
  const queues: JobQueue[] = [];

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await Promise.all(queues.splice(0).map((queue) => queue.stop()));
    db?.close();
    db = null;
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function openIndex(): Promise<BetterSqliteMigrator> {
    dataDir = await mkdtemp(join(tmpdir(), "collector-emb-reconcile-sched-"));
    db = BetterSqliteMigrator.open(join(dataDir, "index.db"));
    await runMigrations(db);
    await db.execute(
      `INSERT INTO vaults (id, path, name, description, is_default, created_at, updated_at)
       VALUES (?, ?, ?, '', 1, ?, ?)`,
      ["v1", dataDir, "V", "t", "t"],
    );
    return db;
  }

  async function insertItem(options: {
    id: string;
    title: string;
    description?: string;
    contentRevision?: number;
  }): Promise<void> {
    const description = options.description ?? "";
    await db!.execute(
      `INSERT INTO items (
        id, vault_id, title, description, content_type, source_type,
        metadata_json, properties_json, has_content_file, folder_path,
        created_at, updated_at, content_revision, word_count, character_count
      ) VALUES (?, 'v1', ?, ?, 'note', 'manual', '{}', '{}', 0, '', 't', 't', ?, 0, 0)`,
      [options.id, options.title, description, options.contentRevision ?? 1],
    );
    await db!.execute(
      `INSERT INTO items_fts (item_id, title, description, content)
       VALUES (?, ?, ?, '')`,
      [options.id, options.title, description],
    );
  }

  async function openQueue(): Promise<JobQueue> {
    const registry = createJobRegistry([refreshEmbeddingsJobType]);
    registry.register(refreshEmbeddingsJobType, async () => ({ status: "ok" }));
    const queue = await createJobQueue({
      dbPath: join(dataDir, "jobs.db"),
      registry,
    });
    queues.push(queue);
    return queue;
  }

  function enqueueRefresh(queue: JobQueue) {
    return async (
      vaultId: string,
      inputs: Parameters<typeof enqueueRefreshEmbeddings>[1]["inputs"],
    ) => {
      await enqueueRefreshEmbeddings(queue, { vaultId, inputs });
    };
  }

  it("documents default interval and batch caps", () => {
    expect(DEFAULT_EMBEDDING_RECONCILE_INTERVAL_MS).toBe(180_000);
    expect(DEFAULT_EMBEDDING_RECONCILE_BATCH_SIZE).toBe(50);
    expect(DEFAULT_EMBEDDING_RECONCILE_SCAN_LIMIT).toBe(200);
  });

  it("runTick plans missing vectors from index and enqueues refreshEmbeddings in jobs.db", async () => {
    const sql = await openIndex();
    await insertItem({
      id: "a.md",
      title: "Garden",
      description: "plants",
    });
    await insertItem({
      id: "b.md",
      title: "Roses",
      description: "flowers",
    });
    const queue = await openQueue();
    const logTick = vi.fn();

    const scheduler = createEmbeddingReconcileScheduler({
      isHealthy: () => true,
      resolveActiveVaultId: () => "v1",
      getDb: () => sql,
      getModelId: () => EMBEDDING_MODEL_ID,
      enqueueRefresh: enqueueRefresh(queue),
      logTick,
    });

    const log = await scheduler.runTick();
    expect(log).toEqual({
      vaultId: "v1",
      scanned: 2,
      enqueued: 2,
      skippedNoSignal: 0,
      deferred: 0,
      batchFull: false,
      errors: 0,
    });
    expect(logTick).toHaveBeenCalledWith(log);

    const stats = await queue.stats();
    expect(stats.pending).toBe(2);
    expect(stats.byType.refreshEmbeddings).toMatchObject({
      pending: 2,
      running: 0,
      succeeded: 0,
      failed: 0,
    });
    scheduler.dispose();
  });

  it("default logTick uses console.error when enqueue errors > 0", async () => {
    const sql = await openIndex();
    await insertItem({
      id: "a.md",
      title: "Garden",
      description: "plants",
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const scheduler = createEmbeddingReconcileScheduler({
      isHealthy: () => true,
      resolveActiveVaultId: () => "v1",
      getDb: () => sql,
      getModelId: () => EMBEDDING_MODEL_ID,
      enqueueRefresh: async () => {
        throw new Error("enqueue failed");
      },
    });

    const log = await scheduler.runTick();
    expect(log?.errors).toBe(1);
    expect(log?.enqueued).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(
      "[collector] embedding reconcile tick",
      expect.objectContaining({ errors: 1 }),
    );
    expect(infoSpy).not.toHaveBeenCalledWith(
      "[collector] embedding reconcile tick",
      expect.anything(),
    );
    scheduler.dispose();
  });

  it("advances keyset cursor across ticks and wraps past the end", async () => {
    const sql = await openIndex();
    await insertItem({ id: "a.md", title: "A", description: "a" });
    await insertItem({ id: "b.md", title: "B", description: "b" });
    const queue = await openQueue();

    const scheduler = createEmbeddingReconcileScheduler({
      isHealthy: () => true,
      resolveActiveVaultId: () => "v1",
      getDb: () => sql,
      getModelId: () => EMBEDDING_MODEL_ID,
      enqueueRefresh: enqueueRefresh(queue),
      batchSize: 1,
      scanLimit: 10,
    });

    const first = await scheduler.runTick();
    expect(first).toMatchObject({
      enqueued: 1,
      scanned: 2,
      deferred: 1,
      batchFull: true,
      errors: 0,
    });
    expect((await queue.stats()).pending).toBe(1);

    const second = await scheduler.runTick();
    expect(second).toMatchObject({
      enqueued: 1,
      deferred: 0,
      batchFull: false,
      errors: 0,
    });
    expect((await queue.stats()).pending).toBe(2);

    // Past end: empty scan with cursor → wrap and rescan from start in same tick.
    const wrapped = await scheduler.runTick();
    expect(wrapped).toMatchObject({
      enqueued: 1,
      errors: 0,
    });
    // Third tick re-enqueues a.md (same digest → dedupe), pending stays 2.
    expect((await queue.stats()).pending).toBe(2);
    scheduler.dispose();
  });

  it("runTick is a no-op when host is unhealthy or vault missing", async () => {
    const sql = await openIndex();
    await insertItem({ id: "a.md", title: "A", description: "a" });
    const queue = await openQueue();

    const unhealthy = createEmbeddingReconcileScheduler({
      isHealthy: () => false,
      resolveActiveVaultId: () => "v1",
      getDb: () => sql,
      getModelId: () => EMBEDDING_MODEL_ID,
      enqueueRefresh: enqueueRefresh(queue),
    });
    expect(await unhealthy.runTick()).toBeNull();
    expect((await queue.stats()).pending).toBe(0);
    unhealthy.dispose();

    const noVault = createEmbeddingReconcileScheduler({
      isHealthy: () => true,
      resolveActiveVaultId: () => null,
      getDb: () => sql,
      getModelId: () => EMBEDDING_MODEL_ID,
      enqueueRefresh: enqueueRefresh(queue),
    });
    expect(await noVault.runTick()).toBeNull();
    expect((await queue.stats()).pending).toBe(0);
    noVault.dispose();
  });

  it("start wakes immediately and arms interval; dispose clears it", async () => {
    vi.useFakeTimers();
    const sql = await openIndex();
    await insertItem({ id: "a.md", title: "A", description: "a" });
    const queue = await openQueue();
    const logs: Array<{ enqueued: number }> = [];

    const scheduler = createEmbeddingReconcileScheduler({
      isHealthy: () => true,
      resolveActiveVaultId: () => "v1",
      getDb: () => sql,
      getModelId: () => EMBEDDING_MODEL_ID,
      enqueueRefresh: enqueueRefresh(queue),
      intervalMs: 5_000,
      logTick: (log) => {
        logs.push({ enqueued: log.enqueued });
      },
    });
    scheduler.start();
    await vi.waitFor(() => {
      expect(logs.length).toBe(1);
    });
    expect((await queue.stats()).pending).toBe(1);

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => {
      expect(logs.length).toBe(2);
    });

    scheduler.dispose();
    const pendingAfterDispose = (await queue.stats()).pending;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(logs.length).toBe(2);
    expect((await queue.stats()).pending).toBe(pendingAfterDispose);
  });

  it("onTickError surfaces planning failures at error severity", async () => {
    vi.useFakeTimers();
    const sql = await openIndex();
    const queue = await openQueue();
    const onTickError = vi.fn();
    sql.close();
    db = null;

    const scheduler = createEmbeddingReconcileScheduler({
      isHealthy: () => true,
      resolveActiveVaultId: () => "v1",
      getDb: () => sql,
      getModelId: () => EMBEDDING_MODEL_ID,
      enqueueRefresh: enqueueRefresh(queue),
      onTickError,
      intervalMs: 1_000,
    });
    scheduler.start();
    await vi.waitFor(() => {
      expect(onTickError).toHaveBeenCalled();
    });
    expect(String(onTickError.mock.calls[0]?.[0])).toMatch(/database|closed|SQLITE/i);
    scheduler.dispose();
  });

  it("wake after start re-runs when vault becomes available (boot order)", async () => {
    vi.useFakeTimers();
    const sql = await openIndex();
    await insertItem({ id: "a.md", title: "A", description: "a" });
    const queue = await openQueue();
    let vaultId: string | null = null;

    const scheduler = createEmbeddingReconcileScheduler({
      isHealthy: () => true,
      resolveActiveVaultId: () => vaultId,
      getDb: () => sql,
      getModelId: () => EMBEDDING_MODEL_ID,
      enqueueRefresh: enqueueRefresh(queue),
      intervalMs: 60_000,
    });
    scheduler.start();
    await vi.waitFor(async () => {
      expect((await queue.stats()).pending).toBe(0);
    });

    vaultId = "v1";
    scheduler.wake();
    await vi.waitFor(async () => {
      expect((await queue.stats()).pending).toBe(1);
    });
    scheduler.dispose();
  });
});
