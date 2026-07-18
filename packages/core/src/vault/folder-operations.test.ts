import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@collector/db";
import { BetterSqliteMigrator } from "../../../db/src/testing/better-sqlite.js";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { createId } from "../util/ids.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createVault, upsertItem } from "../vault/operations.js";
import {
  createFolder,
  listFolderTreeFromIndex,
  reconcileFolderTreeFromDisk,
  renameFolder,
} from "../vault/folder-operations.js";
import { readItemFile } from "../vault/item-io.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";

describe("folder operations", () => {
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

  it("listFolderTreeFromIndex skips item disk scan", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-folder-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    await createFolder(ctx, path, "Work/Articles");
    const itemId = `Work/Articles/${createId()}.md`;
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Note",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });

    const indexTree = await listFolderTreeFromIndex(ctx, path, meta.id);
    expect(indexTree).toHaveLength(1);
    expect(indexTree[0]?.path).toBe("Work");
    expect(indexTree[0]?.item_count).toBe(1);

    const mergedTree = await reconcileFolderTreeFromDisk(ctx, path, meta.id);
    expect(mergedTree[0]?.path).toBe("Work");
    expect(mergedTree[0]?.item_count).toBe(1);
  });

  it("reconcileFolderTreeFromDisk includes folder paths only on disk", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-folder-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    const itemId = `Imports/Drop/${createId()}.md`;
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Dropped",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
    await ctx.index.deleteItem(itemId);

    const indexTree = await listFolderTreeFromIndex(ctx, path, meta.id);
    expect(indexTree).toHaveLength(0);

    const mergedTree = await reconcileFolderTreeFromDisk(ctx, path, meta.id);
    expect(mergedTree).toHaveLength(1);
    expect(mergedTree[0]?.path).toBe("Imports");
    expect(
      mergedTree[0]?.children.some((child) => child.path === "Imports/Drop"),
    ).toBe(true);
  });

  it("renameFolder updates only items under the folder prefix from index", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-folder-rename-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const ctx = { fs, index: new SqlVaultIndexStore(db) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const timestamp = new Date().toISOString();

    await createFolder(ctx, path, "Work/Articles");

    const workRootId = `Work/${createId()}.md`;
    const workNestedId = `Work/Articles/${createId()}.md`;
    const otherId = `Other/${createId()}.md`;

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: workRootId,
        vault_id: meta.id,
        title: "Work root",
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
    });

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: workNestedId,
        vault_id: meta.id,
        title: "Work nested",
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
    });

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: otherId,
        vault_id: meta.id,
        title: "Other",
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
    });

    const upsertSpy = vi.spyOn(ctx.index, "upsertItem");
    const rewriteSpy = vi.spyOn(ctx.index, "rewriteItemIds");

    await renameFolder(ctx, path, meta.id, "Work", "Projects");

    expect(upsertSpy).not.toHaveBeenCalled();
    expect(rewriteSpy).toHaveBeenCalledTimes(1);
    upsertSpy.mockRestore();
    rewriteSpy.mockRestore();

    const newWorkRootId = workRootId.replace("Work/", "Projects/");
    const newWorkNestedId = workNestedId.replace("Work/Articles/", "Projects/Articles/");

    expect(
      (await readItemFile(fs, path, newWorkRootId, meta.id)).folder_path,
    ).toBe("Projects");
    expect(
      (await readItemFile(fs, path, newWorkNestedId, meta.id)).folder_path,
    ).toBe("Projects/Articles");
    expect((await readItemFile(fs, path, otherId, meta.id)).folder_path).toBe(
      "Other",
    );

    expect(
      await ctx.index.listItemIdsByFolderPrefix(meta.id, "Projects"),
    ).toEqual(expect.arrayContaining([newWorkRootId, newWorkNestedId]));
    expect(await ctx.index.listItemIdsByFolderPrefix(meta.id, "Work")).toEqual(
      [],
    );
  });
});
