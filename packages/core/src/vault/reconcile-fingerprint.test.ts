import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "@collector/db";
import { BetterSqliteMigrator } from "../../../db/src/testing/better-sqlite.js";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import {
  createSqlIndexTestSuite,
  noteItemFields,
} from "../index/sql-index-test-harness.js";
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

  override async stat(path: string): Promise<{ mtimeMs: number | null; sizeBytes: number | null }> {
    this.statCount += 1;
    return super.stat(path);
  }
}

describe("reconcile fingerprint against real vault FS + BetterSqlite", () => {
  const suite = createSqlIndexTestSuite();
  suite.registerCleanup();

  let extraDataDir = "";
  let extraDb: BetterSqliteMigrator | null = null;

  afterEach(async () => {
    extraDb?.close();
    extraDb = null;
    if (extraDataDir) {
      await rm(extraDataDir, { recursive: true, force: true });
      extraDataDir = "";
    }
  });

  async function seedIndexedVault(itemCount: number) {
    const env = await suite.openVaultIndex("collector-reconcile-fp-");
    // Replace suite fs with counting adapter for fast-path stat assertions.
    const fs = new CountingFileSystemAdapter();
    const ctx = { fs, index: env.index };
    const { meta, path } = env.vault;
    const timestamp = new Date().toISOString();
    const itemIds: string[] = [];

    for (let i = 0; i < itemCount; i += 1) {
      const itemId = `${createId()}.md`;
      itemIds.push(itemId);
      await upsertItem(ctx, path, meta.id, {
        item: noteItemFields(meta.id, itemId, {
          title: `Note ${i}`,
          created_at: timestamp,
          updated_at: timestamp,
        }),
        content: "body",
      });
    }

    const warmup = await syncIndexFromFilesystem(ctx, path, meta.id);
    expect(warmup.errors).toHaveLength(0);
    return { ctx, meta, path, itemIds, fs, db: env.db };
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
    extraDataDir = await mkdtemp(join(tmpdir(), "collector-reconcile-empty-"));
    extraDb = BetterSqliteMigrator.open(join(extraDataDir, "disk.db"));
    await runMigrations(extraDb);
    const diskCtx = { fs: diskFs, index: new SqlVaultIndexStore(extraDb) };
    const { meta, path } = await createVault(diskCtx, extraDataDir, { name: "Vault" });

    await upsertItem(diskCtx, path, meta.id, {
      item: noteItemFields(meta.id, `${createId()}.md`, {
        title: "On disk",
      }),
      content: "body",
    });
    await syncIndexFromFilesystem(diskCtx, path, meta.id);
    const storedFp = await diskCtx.index.getReconcileFingerprint(meta.id);
    expect(storedFp).not.toBeNull();

    const emptyEnv = await suite.openVaultIndex("collector-reconcile-empty-idx-");
    await emptyEnv.index.upsertVault(meta, path);
    const emptyCtx = { fs: diskFs, index: emptyEnv.index };

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
  });

  it("rejects fast path when there is no stored fingerprint", async () => {
    const { ctx, meta, path, db } = await seedIndexedVault(0);
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
