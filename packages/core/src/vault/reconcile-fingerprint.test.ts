import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "@collector/db";
import { BetterSqliteMigrator } from "../../../db/src/testing/better-sqlite.js";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createId } from "../util/ids.js";
import { createVault } from "./vault-operations.js";
import { upsertItem } from "./item-operations.js";
import { syncIndexFromFilesystem } from "./sync-operations.js";
import { listItemRelativePaths } from "./scan.js";
import {
  canTakeReconcileFastPath,
  parseStoredReconcileFingerprint,
  readVaultReconcileFingerprint,
  reconcileFingerprintsMatch,
  serializeReconcileFingerprint,
} from "./reconcile-fingerprint.js";

class CountingFileSystemAdapter extends NodeFileSystemAdapter {
  statCount = 0;

  override async stat(path: string): Promise<{ mtimeMs: number | null }> {
    this.statCount += 1;
    return super.stat(path);
  }
}

describe("reconcile fingerprint against real vault FS + BetterSqlite", () => {
  let dataDir = "";
  let db: BetterSqliteMigrator | null = null;

  afterEach(async () => {
    db?.close();
    db = null;
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function seedIndexedVault(itemCount: number) {
    dataDir = await mkdtemp(join(tmpdir(), "collector-reconcile-fp-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const fs = new CountingFileSystemAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(db) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const timestamp = new Date().toISOString();
    const itemIds: string[] = [];

    for (let i = 0; i < itemCount; i += 1) {
      const itemId = `${createId()}.md`;
      itemIds.push(itemId);
      await upsertItem(ctx, path, meta.id, {
        item: {
          id: itemId,
          vault_id: meta.id,
          title: `Note ${i}`,
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          properties: {},
          tag_ids: [],
          collection_ids: [],
          folder_path: "",
          content_revision: 1,
          word_count: 0,
          character_count: 0,
          created_at: timestamp,
          updated_at: timestamp,
        },
        content: "body",
      });
    }

    const warmup = await syncIndexFromFilesystem(ctx, path, meta.id);
    expect(warmup.errors).toHaveLength(0);
    return { ctx, meta, path, itemIds, fs };
  }

  it("reads fingerprint from vault root mtime + on-disk item count", async () => {
    const { ctx, path, itemIds } = await seedIndexedVault(2);
    const diskIds = await listItemRelativePaths(ctx.fs, path);
    expect(diskIds.sort()).toEqual([...itemIds].sort());

    const fingerprint = await readVaultReconcileFingerprint(ctx.fs, path, diskIds.length);
    const rootStat = await ctx.fs.stat(path);
    expect(fingerprint.itemCount).toBe(2);
    expect(fingerprint.itemsDirMtimeMs).toBe(rootStat.mtimeMs);
    expect(reconcileFingerprintsMatch(fingerprint, fingerprint)).toBe(true);
    expect(
      reconcileFingerprintsMatch(fingerprint, {
        itemsDirMtimeMs: fingerprint.itemsDirMtimeMs + 1,
        itemCount: 2,
      }),
    ).toBe(false);
  });

  it("round-trips fingerprint through the SQL vaults row", async () => {
    const { ctx, meta, path } = await seedIndexedVault(1);
    const stored = await ctx.index.getReconcileFingerprint(meta.id);
    expect(stored).not.toBeNull();
    if (!stored) {
      throw new Error("expected stored fingerprint after sync");
    }

    const diskIds = await listItemRelativePaths(ctx.fs, path);
    const current = await readVaultReconcileFingerprint(ctx.fs, path, diskIds.length);
    expect(stored).toEqual(current);
    expect(parseStoredReconcileFingerprint(serializeReconcileFingerprint(stored))).toEqual(
      stored,
    );
    expect(parseStoredReconcileFingerprint(null)).toBeNull();
  });

  it("takes fast path when fingerprints and id sets agree (single root stat)", async () => {
    const { ctx, meta, path, itemIds, fs } = await seedIndexedVault(2);
    const diskIds = new Set(await listItemRelativePaths(ctx.fs, path));
    const indexedIds = new Set(await ctx.index.listVaultItemIds(meta.id));
    const stored = await ctx.index.getReconcileFingerprint(meta.id);
    const current = await readVaultReconcileFingerprint(ctx.fs, path, diskIds.size);

    expect(
      canTakeReconcileFastPath({
        storedFingerprint: stored,
        currentFingerprint: current,
        indexedItemCount: indexedIds.size,
        diskItemCount: diskIds.size,
        indexedIds,
        diskItemIds: diskIds,
      }),
    ).toBe(true);
    expect([...indexedIds].sort()).toEqual([...itemIds].sort());

    fs.statCount = 0;
    const report = await syncIndexFromFilesystem(ctx, path, meta.id);
    expect(report.skipped).toBe(2);
    expect(report.indexed).toBe(0);
    expect(report.patched).toBe(0);
    expect(fs.statCount).toBe(1);
  });

  it("rejects fast path when index is empty but disk has items", async () => {
    const diskFs = new NodeFileSystemAdapter();
    dataDir = await mkdtemp(join(tmpdir(), "collector-reconcile-empty-"));
    const diskDb = BetterSqliteMigrator.open(join(dataDir, "disk.db"));
    await runMigrations(diskDb);
    const diskCtx = { fs: diskFs, index: new SqlVaultIndexStore(diskDb) };
    const { meta, path } = await createVault(diskCtx, dataDir, { name: "Vault" });

    await upsertItem(diskCtx, path, meta.id, {
      item: {
        id: `${createId()}.md`,
        vault_id: meta.id,
        title: "On disk",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      content: "body",
    });
    await syncIndexFromFilesystem(diskCtx, path, meta.id);
    const storedFp = await diskCtx.index.getReconcileFingerprint(meta.id);
    expect(storedFp).not.toBeNull();

    db = BetterSqliteMigrator.open(join(dataDir, "empty.db"));
    await runMigrations(db);
    const emptyCtx = { fs: diskFs, index: new SqlVaultIndexStore(db) };
    await emptyCtx.index.upsertVault(meta, path);

    const diskIds = new Set(await listItemRelativePaths(diskFs, path));
    const indexedIds = new Set(await emptyCtx.index.listVaultItemIds(meta.id));
    const current = await readVaultReconcileFingerprint(diskFs, path, diskIds.size);

    expect(
      canTakeReconcileFastPath({
        storedFingerprint: storedFp,
        currentFingerprint: current,
        indexedItemCount: indexedIds.size,
        diskItemCount: diskIds.size,
        indexedIds,
        diskItemIds: diskIds,
      }),
    ).toBe(false);

    const report = await syncIndexFromFilesystem(emptyCtx, path, meta.id);
    expect(report.indexed).toBe(1);
    expect(report.skipped).toBe(0);
    expect(await emptyCtx.index.listVaultItemIds(meta.id)).toHaveLength(1);
    expect(await emptyCtx.index.getReconcileFingerprint(meta.id)).not.toBeNull();

    diskDb.close();
  });

  it("rejects fast path when there is no stored fingerprint", async () => {
    const { ctx, meta, path } = await seedIndexedVault(0);
    if (!db) {
      throw new Error("db required");
    }
    await db.execute(`UPDATE vaults SET reconcile_fingerprint_json = NULL WHERE id = ?`, [
      meta.id,
    ]);
    expect(await ctx.index.getReconcileFingerprint(meta.id)).toBeNull();

    const current = await readVaultReconcileFingerprint(ctx.fs, path, 0);
    expect(
      canTakeReconcileFastPath({
        storedFingerprint: null,
        currentFingerprint: current,
        indexedItemCount: 0,
        diskItemCount: 0,
        indexedIds: new Set(),
        diskItemIds: new Set(),
      }),
    ).toBe(false);
  });
});
