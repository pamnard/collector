import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createId } from "../util/ids.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { createVault, syncIndexFromFilesystem, upsertItem } from "./operations.js";
import { syncIndexItemsFromFilesystem } from "./item-index-sync.js";
import { itemMarkdownPath } from "./paths.js";
import { writeItemFile } from "./item-io.js";

describe("syncIndexItemsFromFilesystem", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("indexes only the requested item ids", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-watch-sync-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const firstId = `${createId()}.md`;
    const secondId = `${createId()}.md`;
    const timestamp = new Date().toISOString();

    for (const itemId of [firstId, secondId]) {
      await upsertItem(ctx, path, meta.id, {
        item: {
          id: itemId,
          vault_id: meta.id,
          title: `Item ${itemId.slice(0, 4)}`,
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          tag_ids: [],
          collection_ids: [],
          folder_path: "",
          content_revision: 1,
          created_at: timestamp,
          updated_at: timestamp,
        },
        content: "body",
      });
    }

    await syncIndexFromFilesystem(ctx, path, meta.id);
    const indexedBefore = await ctx.index.listVaultItemIds(meta.id);
    expect(indexedBefore.sort()).toEqual([firstId, secondId].sort());

    await ctx.index.deleteItem(secondId);
    const targeted = await syncIndexItemsFromFilesystem(ctx, path, meta.id, [secondId]);
    expect(targeted.indexed).toBe(1);
    expect(targeted.errors).toHaveLength(0);
    expect(await ctx.index.listVaultItemIds(meta.id)).toEqual(
      expect.arrayContaining([firstId, secondId]),
    );
  });

  it("removes deleted items from the index", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-watch-delete-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemId = `${createId()}.md`;
    const timestamp = new Date().toISOString();

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Delete me",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        created_at: timestamp,
        updated_at: timestamp,
      },
      content: "body",
    });
    await syncIndexFromFilesystem(ctx, path, meta.id);

    await fs.remove(itemMarkdownPath(path, itemId), { recursive: true });
    const report = await syncIndexItemsFromFilesystem(ctx, path, meta.id, [itemId]);
    expect(report.removed).toBe(1);
    expect(await ctx.index.listVaultItemIds(meta.id)).toEqual([]);
  });

  it("patches metadata when only mtime changed", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-watch-patch-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemId = `${createId()}.md`;
    const timestamp = new Date().toISOString();

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Patch me",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        created_at: timestamp,
        updated_at: timestamp,
      },
      content: "body",
    });
    await syncIndexFromFilesystem(ctx, path, meta.id);

    await writeItemFile(fs, path, {
      id: itemId,
      vault_id: meta.id,
      title: "Patch me",
      description: "",
      content_type: "note",
      source_type: "manual",
      metadata: {},
      tag_ids: [],
      collection_ids: [],
      folder_path: "",
      content_revision: 1,
      created_at: timestamp,
      updated_at: timestamp,
    });

    const report = await syncIndexItemsFromFilesystem(ctx, path, meta.id, [itemId]);
    expect(report.patched + report.skipped).toBeGreaterThanOrEqual(1);
    expect(report.errors).toHaveLength(0);
  });

  it("heals null mtime via touch and indexes the item", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-mtime-touch-heal-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const goodId = `${createId()}.md`;
    const healId = `${createId()}.md`;
    const timestamp = new Date().toISOString();

    for (const itemId of [goodId, healId]) {
      await upsertItem(ctx, path, meta.id, {
        item: {
          id: itemId,
          vault_id: meta.id,
          title: `Item ${itemId.slice(0, 4)}`,
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          tag_ids: [],
          collection_ids: [],
          folder_path: "",
          content_revision: 1,
          created_at: timestamp,
          updated_at: timestamp,
        },
        content: "body",
      });
    }

    await ctx.index.deleteItem(goodId);
    await ctx.index.deleteItem(healId);

    const healPath = itemMarkdownPath(path, healId);
    const originalStat = fs.stat.bind(fs);
    const originalTouch = fs.touch.bind(fs);
    let touched = false;
    fs.stat = async (filePath: string) => {
      if (filePath === healPath && !touched) {
        return { mtimeMs: null };
      }
      return originalStat(filePath);
    };
    fs.touch = async (filePath: string) => {
      if (filePath === healPath) {
        touched = true;
      }
      return originalTouch(filePath);
    };

    try {
      const report = await syncIndexFromFilesystem(ctx, path, meta.id);
      expect(report.errors).toHaveLength(0);
      expect(report.indexed).toBeGreaterThanOrEqual(2);
      const ids = await ctx.index.listVaultItemIds(meta.id);
      expect(ids.sort()).toEqual([goodId, healId].sort());
    } finally {
      fs.stat = originalStat;
      fs.touch = originalTouch;
    }
  });

  it("force-reindexes from frontmatter when touch cannot restore mtime", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-mtime-fm-heal-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemId = `${createId()}.md`;
    const timestamp = "2024-06-15T12:00:00.000Z";

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "From FM",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        created_at: timestamp,
        updated_at: timestamp,
      },
      content: "body",
    });
    await ctx.index.deleteItem(itemId);

    const docPath = itemMarkdownPath(path, itemId);
    const originalStat = fs.stat.bind(fs);
    const originalTouch = fs.touch.bind(fs);
    fs.stat = async (filePath: string) => {
      if (filePath === docPath) {
        return { mtimeMs: null };
      }
      return originalStat(filePath);
    };
    fs.touch = async () => {
      // intentional no-op: mtime stays null
    };

    try {
      const report = await syncIndexFromFilesystem(ctx, path, meta.id);
      expect(report.errors).toHaveLength(0);
      expect(report.indexed).toBeGreaterThanOrEqual(1);
      const syncMeta = await ctx.index.listVaultItemSyncMeta(meta.id);
      const row = syncMeta.find((entry) => entry.id === itemId);
      expect(row).toBeDefined();
      expect(row!.file_mtime_ms).toBe(Date.parse(row!.updated_at));
      expect(row!.file_mtime_ms).not.toBeNull();
    } finally {
      fs.stat = originalStat;
      fs.touch = originalTouch;
    }
  });

  it("records per-item error when document cannot provide mtime and continues others", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-mtime-error-isolate-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const goodId = `${createId()}.md`;
    const badId = `${createId()}.md`;
    const timestamp = new Date().toISOString();

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: goodId,
        vault_id: meta.id,
        title: "Good",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        created_at: timestamp,
        updated_at: timestamp,
      },
      content: "ok",
    });
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: badId,
        vault_id: meta.id,
        title: "Bad",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        created_at: timestamp,
        updated_at: timestamp,
      },
      content: "bad",
    });
    await ctx.index.deleteItem(goodId);
    await ctx.index.deleteItem(badId);

    const badPath = itemMarkdownPath(path, badId);
    await fs.writeText(badPath, "---\ntitle: No dates\n---\n\nbody\n");

    const originalStat = fs.stat.bind(fs);
    const originalTouch = fs.touch.bind(fs);
    fs.stat = async (filePath: string) => {
      if (filePath === badPath) {
        return { mtimeMs: null };
      }
      return originalStat(filePath);
    };
    fs.touch = async () => {};

    try {
      const report = await syncIndexFromFilesystem(ctx, path, meta.id);
      expect(report.errors.some((error) => error.itemId === badId)).toBe(true);
      const ids = await ctx.index.listVaultItemIds(meta.id);
      expect(ids).toContain(goodId);
      expect(ids).not.toContain(badId);
    } finally {
      fs.stat = originalStat;
      fs.touch = originalTouch;
    }
  });
});
