import { afterEach, describe, expect, it } from "vitest";
import {
  createSqlIndexTestSuite,
  noteItemFields,
} from "../index/sql-index-test-harness.js";
import { createId } from "../util/ids.js";
import { upsertItem } from "./item-operations.js";
import {
  createFolder,
  readVaultFolderPaths,
  reconcileFolderTreeFromDisk,
} from "./folder-operations.js";
import { buildFolderTree, collectFolderPaths } from "./folder-tree.js";
import { itemMarkdownPath } from "./paths.js";

describe("collectFolderPaths / buildFolderTree against real vault FS", () => {
  const suite = createSqlIndexTestSuite();
  suite.registerCleanup();

  it("collects nested ancestor prefixes from on-disk folder listing", async () => {
    const { ctx, vault } = await suite.openVaultIndex("collector-folder-tree-");
    const { path } = vault;
    await createFolder(ctx, path, "Work/Projects/Alpha/Notes");
    await createFolder(ctx, path, "Work/Projects/Beta");
    await createFolder(ctx, path, "Archive/2024/Q1");

    const diskPaths = await readVaultFolderPaths(ctx, path);
    expect(diskPaths).toEqual([
      "Archive",
      "Archive/2024",
      "Archive/2024/Q1",
      "Inbox",
      "Work",
      "Work/Projects",
      "Work/Projects/Alpha",
      "Work/Projects/Alpha/Notes",
      "Work/Projects/Beta",
    ]);
    expect(collectFolderPaths(diskPaths)).toEqual(diskPaths);
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
    const { ctx, fs, vault } = await suite.openVaultIndex("collector-folder-tree-");
    const { meta, path } = vault;
    const timestamp = new Date().toISOString();

    await createFolder(ctx, path, "Work/Projects/Alpha/Notes");
    await createFolder(ctx, path, "Work/Projects/Beta");
    await createFolder(ctx, path, "Archive/2024/Q1");

    const itemIds = [
      `Work/Projects/Alpha/Notes/${createId()}.md`,
      `Work/Projects/Alpha/Notes/${createId()}.md`,
      `Work/Projects/Beta/${createId()}.md`,
      `Archive/2024/Q1/${createId()}.md`,
      `Archive/2024/Q1/${createId()}.md`,
      `Archive/2024/Q1/${createId()}.md`,
    ];

    for (const itemId of itemIds) {
      await upsertItem(ctx, path, meta.id, {
        item: noteItemFields(meta.id, itemId, {
          created_at: timestamp,
          updated_at: timestamp,
        }),
        content: "body",
      });
      expect(await fs.exists(itemMarkdownPath(path, itemId))).toBe(true);
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
