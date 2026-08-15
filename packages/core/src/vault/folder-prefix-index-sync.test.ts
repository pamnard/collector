import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createId } from "../util/ids.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { createVault } from "./vault-operations.js";
import { upsertItem } from "./item-operations.js";
import { syncIndexFromFilesystem } from "./sync-operations.js";
import { createFolder } from "./folder-operations.js";
import { reconcileIndexFolderPrefixFromFilesystem } from "./folder-prefix-index-sync.js";
import { joinSegments } from "./paths.js";
import { listItemRelativePathsUnderPrefix } from "./scan.js";

describe("reconcileIndexFolderPrefixFromFilesystem (#567)", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function setupVault() {
    dataDir = await mkdtemp(join(tmpdir(), "collector-folder-prefix-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    return { ctx, meta, path };
  }

  it("removes all indexed items when a nested non-empty folder is deleted", async () => {
    const { ctx, meta, path } = await setupVault();
    await createFolder(ctx, path, "Parent/Child");
    const nestedId = `Parent/Child/${createId()}.md`;
    const siblingId = `Parent/${createId()}.md`;
    const timestamp = new Date().toISOString();

    for (const itemId of [nestedId, siblingId]) {
      await upsertItem(ctx, path, meta.id, {
        item: {
          id: itemId,
          vault_id: meta.id,
          title: itemId,
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
    await syncIndexFromFilesystem(ctx, path, meta.id);

    await fs.remove(joinSegments(path, "Parent", "Child"), { recursive: true });

    const report = await reconcileIndexFolderPrefixFromFilesystem(
      ctx,
      path,
      meta.id,
      "Parent/Child",
    );
    expect(report.removed).toBe(1);
    expect(await ctx.index.listVaultItemIds(meta.id)).toEqual([siblingId]);
  });

  it("indexes new markdown under a created folder tree", async () => {
    const { ctx, meta, path } = await setupVault();
    await createFolder(ctx, path, "Imports/Drop");
    const itemId = `Imports/Drop/${createId()}.md`;
    const timestamp = new Date().toISOString();

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Dropped",
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
    await ctx.index.deleteItem(itemId);

    const report = await reconcileIndexFolderPrefixFromFilesystem(
      ctx,
      path,
      meta.id,
      "Imports",
    );
    expect(report.indexed).toBeGreaterThanOrEqual(1);
    expect(await ctx.index.listVaultItemIds(meta.id)).toEqual([itemId]);
  });

  it("no-ops for an empty folder that still exists", async () => {
    const { ctx, meta, path } = await setupVault();
    await createFolder(ctx, path, "EmptyOnly");

    const report = await reconcileIndexFolderPrefixFromFilesystem(
      ctx,
      path,
      meta.id,
      "EmptyOnly",
    );
    expect(report.removed).toBe(0);
    expect(report.indexed).toBe(0);
    expect(await ctx.index.listVaultItemIds(meta.id)).toEqual([]);
  });

  it("lists disk items under a prefix", async () => {
    const { ctx, path } = await setupVault();
    await createFolder(ctx, path, "A/B");
    const id = `A/B/${createId()}.md`;
    await fs.writeText(joinSegments(path, id), "---\ntitle: x\n---\n");

    await expect(
      listItemRelativePathsUnderPrefix(fs, path, "A"),
    ).resolves.toEqual([id]);
    await expect(
      listItemRelativePathsUnderPrefix(fs, path, "Missing"),
    ).resolves.toEqual([]);
  });
});
