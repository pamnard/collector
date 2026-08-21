import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FolderTreeNode } from "@collector/core";
import { patchFolderTreeItemCounts } from "./folder-tree-count-patch.ts";

describe("patchFolderTreeItemCounts sidebar identity (#756)", () => {
  it("updates counts without replacing unrelated node identity", () => {
    const leaf: FolderTreeNode = {
      name: "Leaf",
      path: "Projects/Leaf",
      item_count: 2,
      children: [],
    };
    const projects: FolderTreeNode = {
      name: "Projects",
      path: "Projects",
      item_count: 2,
      children: [leaf],
    };
    const inbox: FolderTreeNode = {
      name: "Inbox",
      path: "Inbox",
      item_count: 4,
      children: [],
    };
    const tree = [projects, inbox];
    const next = patchFolderTreeItemCounts(
      tree,
      new Map([
        ["Projects/Leaf", 1],
        ["Projects", 1],
      ]),
    );
    assert.equal(next[1], inbox);
    assert.notEqual(next[0], projects);
    assert.equal(next[0]?.item_count, 3);
    assert.equal(next[0]?.children[0]?.item_count, 3);
  });
});
