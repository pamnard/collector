import { describe, expect, it } from "vitest";
import { buildFolderTree, collectFolderPaths } from "./folder-tree.js";

/** Nested-path fixture for #789: deep tree + sibling branches. */
const NESTED_PATH_FIXTURE = [
  "Work/Projects/Alpha/Notes",
  "Work/Projects/Beta",
  "Archive/2024/Q1",
  "Inbox",
];

describe("collectFolderPaths", () => {
  it("collects nested ancestor prefixes as a sorted unique list", () => {
    expect(collectFolderPaths(NESTED_PATH_FIXTURE)).toEqual([
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

  it("dedupes overlapping paths", () => {
    expect(
      collectFolderPaths(["Work/Projects/Alpha", "Work/Projects", "Work"]),
    ).toEqual(["Work", "Work/Projects", "Work/Projects/Alpha"]);
  });
});

describe("buildFolderTree", () => {
  it("preserves nested fixture shape and display order", () => {
    const counts = new Map<string, number>([
      ["Work/Projects/Alpha/Notes", 2],
      ["Work/Projects/Beta", 1],
      ["Archive/2024/Q1", 3],
      ["Inbox", 0],
    ]);

    const tree = buildFolderTree(NESTED_PATH_FIXTURE, counts);

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
  });
});
