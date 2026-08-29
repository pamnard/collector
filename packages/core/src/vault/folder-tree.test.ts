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
import {
  createFolder,
  readVaultFolderPaths,
  reconcileFolderTreeFromDisk,
} from "./folder-operations.js";
import { buildFolderTree, collectFolderPaths } from "./folder-tree.js";
import { joinSegments } from "./paths.js";

describe("collectFolderPaths / buildFolderTree against real vault FS", () => {
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
    dataDir = await mkdtemp(join(tmpdir(), "collector-folder-tree-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const ctx = { fs, index: new SqlVaultIndexStore(db) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    return { ctx, meta, path };
  }

  it("collects nested ancestor prefixes from on-disk folder listing", async () => {
    const { ctx, path } = await seedVault();
    await createFolder(ctx, path, "Work/Projects/Alpha/Notes");
    await createFolder(ctx, path, "Work/Projects/Beta");
    await createFolder(ctx, path, "Archive/2024/Q1");

    const diskPaths = await readVaultFolderPaths(ctx, path);
    expect(diskPaths).toEqual(
      expect.arrayContaining([
        "Work/Projects/Alpha/Notes",
        "Work/Projects/Beta",
        "Archive/2024/Q1",
        "Inbox",
      ]),
    );
    expect(collectFolderPaths(diskPaths)).toEqual(
      expect.arrayContaining([
        "Archive",
        "Archive/2024",
        "Archive/2024/Q1",
        "Inbox",
        "Work",
        "Work/Projects",
        "Work/Projects/Alpha",
        "Work/Projects/Alpha/Notes",
        "Work/Projects/Beta",
      ]),
    );
  });

  it("skips empty and whitespace-only paths", () => {
    expect(collectFolderPaths(["", "   ", "/", "//"])).toEqual([]);
  });

  it("normalizes separators and trims segments before collecting", () => {
    expect(collectFolderPaths(["  Work\\\\Projects/Alpha  ", "Work/Projects"])).toEqual([
      "Work",
      "Work/Projects",
      "Work/Projects/Alpha",
    ]);
  });

  it("builds tree with rolled-up index counts matching disk layout", async () => {
    const { ctx, meta, path } = await seedVault();
    const timestamp = new Date().toISOString();

    await createFolder(ctx, path, "Work/Projects/Alpha/Notes");
    await createFolder(ctx, path, "Work/Projects/Beta");
    await createFolder(ctx, path, "Archive/2024/Q1");

    const notesIds = [
      `Work/Projects/Alpha/Notes/${createId()}.md`,
      `Work/Projects/Alpha/Notes/${createId()}.md`,
    ];
    const betaId = `Work/Projects/Beta/${createId()}.md`;
    const archiveIds = [
      `Archive/2024/Q1/${createId()}.md`,
      `Archive/2024/Q1/${createId()}.md`,
      `Archive/2024/Q1/${createId()}.md`,
    ];

    for (const itemId of [...notesIds, betaId, ...archiveIds]) {
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

    for (const itemId of [...notesIds, betaId, ...archiveIds]) {
      expect(await fs.exists(joinSegments(path, itemId))).toBe(true);
    }

    const tree = await reconcileFolderTreeFromDisk(ctx, path, meta.id);
    expect(tree.map((node) => node.path)).toEqual(["Inbox", "Archive", "Work"]);
    expect(tree.find((node) => node.path === "Work")?.children.map((c) => c.path)).toEqual([
      "Work/Projects",
    ]);
    expect(
      tree
        .find((node) => node.path === "Work")
        ?.children[0]?.children.map((c) => c.path),
    ).toEqual(["Work/Projects/Alpha", "Work/Projects/Beta"]);
    expect(
      tree
        .find((node) => node.path === "Work")
        ?.children[0]?.children.find((c) => c.path === "Work/Projects/Alpha")
        ?.children.map((c) => c.path),
    ).toEqual(["Work/Projects/Alpha/Notes"]);
    expect(tree.find((node) => node.path === "Archive")?.item_count).toBe(3);
    expect(tree.find((node) => node.path === "Work")?.item_count).toBe(3);
    expect(tree.find((node) => node.path === "Inbox")?.item_count).toBe(0);

    const counts = await ctx.index.listFolderItemCounts(meta.id);
    const countMap = new Map(counts.map((row) => [row.folder_path, row.item_count]));
    const diskPaths = await readVaultFolderPaths(ctx, path);
    const pureTree = buildFolderTree(diskPaths, countMap);
    expect(pureTree.map((n) => n.path)).toEqual(tree.map((n) => n.path));
    expect(pureTree.find((n) => n.path === "Work")?.item_count).toBe(3);
  });
});
