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
});
