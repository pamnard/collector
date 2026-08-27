import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@collector/db";
import { BetterSqliteMigrator } from "../../../db/src/testing/better-sqlite.js";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { createId } from "../util/ids.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createVault } from "../vault/vault-operations.js";
import { upsertItem } from "../vault/item-operations.js";
import {
  createFolder,
  deleteFolder,
  listFolderItems,
  listFolderTreeFromIndex,
  moveItemToFolder,
  reconcileFolderTreeFromDisk,
  renameFolder,
} from "../vault/folder-operations.js";
import { readItemFile } from "../vault/item-io.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import {
  itemMediaRoot,
  joinSegments,
  noteUuidFromItemPath,
} from "../vault/paths.js";
import { attachMediaFile } from "../vault/media-operations.js";

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

  it("listFolderTreeFromIndex always includes Inbox even when empty", async () => {
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
    });

    const indexTree = await listFolderTreeFromIndex(ctx, path, meta.id);
    expect(indexTree.map((node) => node.path)).toEqual(["Inbox", "Work"]);
    expect(indexTree.find((node) => node.path === "Inbox")?.item_count).toBe(0);
    expect(indexTree.find((node) => node.path === "Work")?.item_count).toBe(1);

    const mergedTree = await reconcileFolderTreeFromDisk(ctx, path, meta.id);
    expect(mergedTree.map((node) => node.path)).toEqual(["Inbox", "Work"]);
    expect(mergedTree.find((node) => node.path === "Work")?.item_count).toBe(1);
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
    });
    await ctx.index.deleteItem(itemId);

    const indexTree = await listFolderTreeFromIndex(ctx, path, meta.id);
    expect(indexTree.map((node) => node.path)).toEqual(["Inbox"]);

    const mergedTree = await reconcileFolderTreeFromDisk(ctx, path, meta.id);
    expect(mergedTree.map((node) => node.path)).toEqual(["Inbox", "Imports"]);
    expect(
      mergedTree
        .find((node) => node.path === "Imports")
        ?.children.some((child) => child.path === "Imports/Drop"),
    ).toBe(true);
  });

  it("renameFolder rejects move into self or descendant", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-folder-illegal-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const ctx = { fs, index: new SqlVaultIndexStore(db) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    await createFolder(ctx, path, "A/B");
    await createFolder(ctx, path, "C");

    await expect(
      renameFolder(ctx, path, meta.id, "A", "A/B/A"),
    ).rejects.toThrow(/itself or a descendant/i);

    await expect(
      renameFolder(ctx, path, meta.id, "A/B", "A/B/Nested"),
    ).rejects.toThrow(/itself or a descendant/i);

    const moved = await renameFolder(ctx, path, meta.id, "A/B", "C/B");
    expect(moved).toBe("C/B");
    expect(await ctx.fs.exists(joinSegments(path, "C/B"))).toBe(true);
    expect(await ctx.fs.exists(joinSegments(path, "A/B"))).toBe(false);
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

  it("deleteFolder removes an empty folder", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-folder-delete-empty-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const ctx = { fs, index: new SqlVaultIndexStore(db) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    await createFolder(ctx, path, "Archive/Ready");
    await deleteFolder(ctx, path, meta.id, "Archive/Ready");

    expect(await ctx.fs.exists(joinSegments(path, "Archive/Ready"))).toBe(false);
    expect(await ctx.fs.exists(joinSegments(path, "Archive"))).toBe(true);
  });

  it("deleteFolder rejects vault root", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-folder-delete-root-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const ctx = { fs, index: new SqlVaultIndexStore(db) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    await expect(deleteFolder(ctx, path, meta.id, "")).rejects.toThrow(
      /vault root/i,
    );
  });

  it("deleteFolder recursively removes nested folders, items, and media (#572)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-folder-delete-nested-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const ctx = { fs, index: new SqlVaultIndexStore(db) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const timestamp = new Date().toISOString();

    await createFolder(ctx, path, "Work/Articles");
    const rootId = `Work/${createId()}.md`;
    const nestedId = `Work/Articles/${createId()}.md`;
    const otherId = `Other/${createId()}.md`;

    for (const [id, title] of [
      [rootId, "Work root"],
      [nestedId, "Work nested"],
      [otherId, "Other"],
    ] as const) {
      await upsertItem(ctx, path, meta.id, {
        item: {
          id,
          vault_id: meta.id,
          title,
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
      });
    }

    await attachMediaFile(ctx, path, nestedId, {
      filename: "shot.png",
      data: Uint8Array.from([9, 8, 7]),
    });
    const mediaRoot = itemMediaRoot(path, nestedId);
    expect(await fs.exists(mediaRoot)).toBe(true);

    await deleteFolder(ctx, path, meta.id, "Work");

    expect(await ctx.fs.exists(joinSegments(path, "Work"))).toBe(false);
    expect(await ctx.fs.exists(joinSegments(path, "Work/Articles"))).toBe(false);
    expect(await fs.exists(mediaRoot)).toBe(false);
    expect(await ctx.index.listItemIdsByFolderPrefix(meta.id, "Work")).toEqual(
      [],
    );
    expect(await ctx.index.listItemIdsByFolderPrefix(meta.id, "Other")).toEqual([
      otherId,
    ]);
    expect((await readItemFile(fs, path, otherId, meta.id)).folder_path).toBe(
      "Other",
    );
  });

  it("moveItemToFolder does not move media/<uuid>/ (#279)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-folder-move-media-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const uuid = createId();
    const itemId = `Inbox/${uuid}.md`;

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Moving",
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
    });

    await attachMediaFile(ctx, path, itemId, {
      filename: "keep.png",
      data: Uint8Array.from([1, 2, 3]),
    });
    const mediaRoot = itemMediaRoot(path, itemId);
    expect(mediaRoot).toBe(joinSegments(path, "media", noteUuidFromItemPath(itemId)));
    expect(await fs.exists(mediaRoot)).toBe(true);

    await createFolder(ctx, path, "Archive");
    const moved = await moveItemToFolder(ctx, path, meta.id, itemId, "Archive");
    expect(moved.id).toBe(`Archive/${uuid}.md`);
    expect(await fs.exists(mediaRoot)).toBe(true);
    expect(itemMediaRoot(path, moved.id)).toBe(mediaRoot);
  });

  it("moveItemToFolder enqueues embedding refresh for the new item id (#740)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-folder-move-embed-"));
    const sql = new MemorySqlAdapter();
    const enqueued: Array<{ vaultId: string; itemIds: string[] }> = [];
    const ctx = {
      fs,
      index: new SqlVaultIndexStore(sql),
      embeddingRefreshJobs: {
        enqueue: async (
          vaultId: string,
          inputs: Array<{ itemId: string }>,
        ) => {
          enqueued.push({
            vaultId,
            itemIds: inputs.map((input) => input.itemId),
          });
        },
      },
    };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const uuid = createId();
    const itemId = `Inbox/${uuid}.md`;
    const newId = `Archive/${uuid}.md`;

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Port checker",
        description: "CLI tool for listening TCP ports",
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
      content: "Find which process holds a listening port.",
    });
    enqueued.length = 0;

    await createFolder(ctx, path, "Archive");
    const moved = await moveItemToFolder(ctx, path, meta.id, itemId, "Archive");
    expect(moved.id).toBe(newId);
    expect(enqueued).toEqual([{ vaultId: meta.id, itemIds: [newId] }]);
  });

  it("listFolderItems returns exact-folder members only; empty ok; missing fails (#844)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-list-folder-items-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    await createFolder(ctx, path, "Parent");
    await createFolder(ctx, path, "Parent/Child");
    await createFolder(ctx, path, "Empty");

    const timestamp = new Date().toISOString();
    const parentId = `Parent/${createId()}.md`;
    const childId = `Parent/Child/${createId()}.md`;
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: parentId,
        vault_id: meta.id,
        title: "Parent note",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "Parent",
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: timestamp,
        updated_at: timestamp,
      },
    });
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: childId,
        vault_id: meta.id,
        title: "Child note",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "Parent/Child",
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: timestamp,
        updated_at: timestamp,
      },
    });

    const parentItems = await listFolderItems(ctx, path, meta.id, "Parent");
    expect(parentItems.map((item) => item.id)).toEqual([parentId]);
    expect(parentItems[0]?.title).toBe("Parent note");

    await expect(listFolderItems(ctx, path, meta.id, "Empty")).resolves.toEqual(
      [],
    );
    await expect(
      listFolderItems(ctx, path, meta.id, "Missing"),
    ).rejects.toThrow(/Folder not found: Missing/);
    await expect(listFolderItems(ctx, path, meta.id, "")).rejects.toThrow(
      /Folder path must be non-empty/,
    );
  });
});
