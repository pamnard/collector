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
import { readItemFile, writeItemFile } from "./item-io.js";
import { syncIndexFromFilesystem } from "./sync-operations.js";
import { syncIndexItemsFromFilesystem } from "./item-index-sync.js";
import { itemMarkdownPath } from "./paths.js";

describe("classifyItemSyncAction via FS + BetterSqlite index", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();
  let db: BetterSqliteMigrator | null = null;

  afterEach(async () => {
    db?.close();
    db = null;
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function seedVault() {
    dataDir = await mkdtemp(join(tmpdir(), "collector-sync-classify-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const ctx = { fs, index: new SqlVaultIndexStore(db) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    return { ctx, meta, path };
  }

  async function seedNote(
    ctx: { fs: NodeFileSystemAdapter; index: SqlVaultIndexStore },
    path: string,
    vaultId: string,
  ) {
    const itemId = `${createId()}.md`;
    const timestamp = new Date().toISOString();
    const item = await upsertItem(ctx, path, vaultId, {
      item: {
        id: itemId,
        vault_id: vaultId,
        title: "Note",
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
      content: "hello",
    });
    return { itemId, item };
  }

  it("reindexes items missing from the index", async () => {
    const { ctx, meta, path } = await seedVault();
    const { itemId } = await seedNote(ctx, path, meta.id);
    expect(await fs.exists(itemMarkdownPath(path, itemId))).toBe(true);

    await ctx.index.deleteItem(itemId);
    expect(await ctx.index.listVaultItemIds(meta.id)).toEqual([]);

    // Targeted sync: bypasses vault fingerprint fast-path so classify runs.
    const report = await syncIndexItemsFromFilesystem(ctx, path, meta.id, [itemId]);
    expect(report.indexed).toBe(1);
    expect(report.skipped).toBe(0);
    expect(report.patched).toBe(0);
    expect(await ctx.index.listVaultItemIds(meta.id)).toEqual([itemId]);
  });

  it("skips when mtime and created_at match the index", async () => {
    const { ctx, meta, path } = await seedVault();
    const { itemId } = await seedNote(ctx, path, meta.id);

    const report = await syncIndexItemsFromFilesystem(ctx, path, meta.id, [itemId]);
    expect(report.skipped).toBe(1);
    expect(report.indexed).toBe(0);
    expect(report.patched).toBe(0);

    const [metaRow] = await ctx.index.listItemSyncMetaByIds(meta.id, [itemId]);
    expect(metaRow?.file_mtime_ms).not.toBeNull();
    const diskMtime = (await fs.stat(itemMarkdownPath(path, itemId))).mtimeMs;
    expect(metaRow?.file_mtime_ms).toBe(diskMtime);
  });

  it("patches when mtime matches but created_at drifted", async () => {
    const { ctx, meta, path } = await seedVault();
    const { itemId, item } = await seedNote(ctx, path, meta.id);
    await syncIndexFromFilesystem(ctx, path, meta.id);

    const [before] = await ctx.index.listItemSyncMetaByIds(meta.id, [itemId]);
    if (before?.file_mtime_ms === null || before?.file_mtime_ms === undefined) {
      throw new Error("expected indexed mtime");
    }

    await ctx.index.patchItemSyncMeta(itemId, {
      fileMtimeMs: before.file_mtime_ms,
      updatedAt: item.updated_at,
      contentRevision: item.content_revision,
      createdAt: "1999-01-01T00:00:00.000Z",
    });

    const report = await syncIndexItemsFromFilesystem(ctx, path, meta.id, [itemId]);
    expect(report.patched).toBe(1);
    expect(report.indexed).toBe(0);
    expect(report.skipped).toBe(0);

    const [after] = await ctx.index.listItemSyncMetaByIds(meta.id, [itemId]);
    expect(after?.created_at).toBe(item.created_at);
    expect(after?.created_at).not.toBe("1999-01-01T00:00:00.000Z");
  });

  it("patches when mtime is unknown but metadata matches", async () => {
    const { ctx, meta, path } = await seedVault();
    const { itemId, item } = await seedNote(ctx, path, meta.id);
    await syncIndexFromFilesystem(ctx, path, meta.id);

    if (!db) {
      throw new Error("db required");
    }
    await db.execute(`UPDATE items SET file_mtime_ms = NULL WHERE id = ?`, [itemId]);
    const [nulled] = await ctx.index.listItemSyncMetaByIds(meta.id, [itemId]);
    expect(nulled?.file_mtime_ms).toBeNull();
    expect(nulled?.updated_at).toBe(item.updated_at);

    const report = await syncIndexItemsFromFilesystem(ctx, path, meta.id, [itemId]);
    expect(report.patched).toBe(1);
    expect(report.indexed).toBe(0);

    const [after] = await ctx.index.listItemSyncMetaByIds(meta.id, [itemId]);
    expect(after?.file_mtime_ms).not.toBeNull();
    expect(after?.file_mtime_ms).toBe(
      (await fs.stat(itemMarkdownPath(path, itemId))).mtimeMs,
    );
  });

  it("patches when mtime differs but metadata matches", async () => {
    const { ctx, meta, path } = await seedVault();
    const { itemId, item } = await seedNote(ctx, path, meta.id);

    await ctx.index.patchItemSyncMeta(itemId, {
      fileMtimeMs: 1,
      updatedAt: item.updated_at,
      contentRevision: item.content_revision,
      createdAt: item.created_at,
    });

    const report = await syncIndexItemsFromFilesystem(ctx, path, meta.id, [itemId]);
    expect(report.patched).toBe(1);
    expect(report.indexed).toBe(0);
    expect(report.skipped).toBe(0);

    const [after] = await ctx.index.listItemSyncMetaByIds(meta.id, [itemId]);
    expect(after?.file_mtime_ms).toBe(
      (await fs.stat(itemMarkdownPath(path, itemId))).mtimeMs,
    );
    expect(after?.file_mtime_ms).not.toBe(1);
  });

  it("reindexes when metadata changed", async () => {
    const { ctx, meta, path } = await seedVault();
    const { itemId } = await seedNote(ctx, path, meta.id);
    await syncIndexFromFilesystem(ctx, path, meta.id);

    const onDisk = await readItemFile(fs, path, itemId, meta.id);
    await writeItemFile(fs, path, {
      ...onDisk,
      updated_at: "2023-01-01T00:00:00.000Z",
    });

    const report = await syncIndexItemsFromFilesystem(ctx, path, meta.id, [itemId]);
    expect(report.indexed).toBe(1);
    expect(report.patched).toBe(0);

    const [after] = await ctx.index.listItemSyncMetaByIds(meta.id, [itemId]);
    expect(after?.updated_at).toBe("2023-01-01T00:00:00.000Z");
  });

  it("reindexes when content revision changed", async () => {
    const { ctx, meta, path } = await seedVault();
    const { itemId } = await seedNote(ctx, path, meta.id);
    await syncIndexFromFilesystem(ctx, path, meta.id);

    const onDisk = await readItemFile(fs, path, itemId, meta.id);
    await writeItemFile(fs, path, {
      ...onDisk,
      content_revision: onDisk.content_revision + 1,
    });

    const report = await syncIndexItemsFromFilesystem(ctx, path, meta.id, [itemId]);
    expect(report.indexed).toBe(1);
    expect(report.patched).toBe(0);

    const [after] = await ctx.index.listItemSyncMetaByIds(meta.id, [itemId]);
    expect(after?.content_revision).toBe(onDisk.content_revision + 1);
  });
});
