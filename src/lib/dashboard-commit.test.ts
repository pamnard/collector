import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ItemFile } from "@collector/shared";
import {
  itemsBodiesEqual,
  mergeCommittedThumbnailPaths,
  orderedIds,
  shouldSkipEmptyCommit,
  snapshotToCacheEntry,
  thumbnailPathsEqual,
} from "./dashboard-commit.ts";

function stubItem(
  id: string,
  overrides: Partial<ItemFile> = {},
): ItemFile {
  return {
    id,
    title: id,
    updated_at: "2026-01-01T00:00:00.000Z",
    thumbnail: null,
    ...overrides,
  } as ItemFile;
}

describe("orderedIds", () => {
  it("maps item ids in order", () => {
    assert.deepEqual(orderedIds([stubItem("a"), stubItem("b")]), ["a", "b"]);
  });
});

describe("thumbnailPathsEqual", () => {
  it("compares only listed ids", () => {
    const left = new Map<string, string | null>([
      ["a", "/a"],
      ["b", null],
    ]);
    const right = new Map<string, string | null>([
      ["a", "/a"],
      ["b", "/b"],
    ]);
    assert.equal(thumbnailPathsEqual(left, right, ["a"]), true);
    assert.equal(thumbnailPathsEqual(left, right, ["a", "b"]), false);
  });

  it("treats missing as null", () => {
    const left = new Map<string, string | null>();
    const right = new Map<string, string | null>([["a", null]]);
    assert.equal(thumbnailPathsEqual(left, right, ["a"]), true);
  });
});

describe("itemsBodiesEqual", () => {
  it("requires same length and body fields", () => {
    const a = stubItem("a", { title: "A" });
    const b = stubItem("a", { title: "A" });
    const c = stubItem("a", { title: "B" });
    assert.equal(itemsBodiesEqual([a], [b]), true);
    assert.equal(itemsBodiesEqual([a], [c]), false);
    assert.equal(itemsBodiesEqual([a], []), false);
  });
});

describe("shouldSkipEmptyCommit", () => {
  it("skips blanking when previous paint exists and total stays positive", () => {
    assert.equal(shouldSkipEmptyCommit(0, 3, 10), true);
    assert.equal(shouldSkipEmptyCommit(0, 0, 10), false);
    assert.equal(shouldSkipEmptyCommit(0, 3, 0), false);
    assert.equal(shouldSkipEmptyCommit(1, 3, 10), false);
  });
});

describe("mergeCommittedThumbnailPaths", () => {
  it("merges resolved paths and prunes ids not in ordered set", () => {
    const prev = new Map<string, string | null>([
      ["a", "/old-a"],
      ["gone", "/x"],
    ]);
    const resolved = new Map<string, string | null>([
      ["a", "/new-a"],
      ["b", null],
    ]);
    const merged = mergeCommittedThumbnailPaths(prev, resolved, ["a", "b"]);
    assert.deepEqual([...merged.entries()], [
      ["a", "/new-a"],
      ["b", null],
    ]);
  });

  it("keeps prev path when resolved omits id", () => {
    const prev = new Map<string, string | null>([["a", "/keep"]]);
    const resolved = new Map<string, string | null>();
    const merged = mergeCommittedThumbnailPaths(prev, resolved, ["a"]);
    assert.equal(merged.get("a"), "/keep");
  });
});

describe("snapshotToCacheEntry", () => {
  it("maps snapshot fields into a cache entry", () => {
    const item = stubItem("a");
    const entry = snapshotToCacheEntry({
      schema_version: 1,
      vault_id: "00000000-0000-4000-8000-000000000001",
      nav_filter: "all",
      search: "",
      sort_key: "created_at",
      sort_dir: "desc",
      item_ids: ["a"],
      items: [item],
      stream_end_offset: 1,
      total_count: 5,
      saved_at: "2026-01-01T00:00:00.000Z",
    });
    assert.deepEqual(entry.itemIds, ["a"]);
    assert.equal(entry.itemsById.get("a"), item);
    assert.equal(entry.streamEndOffset, 1);
    assert.equal(entry.totalCount, 5);
    assert.equal(entry.thumbnailPaths.size, 0);
    assert.equal(typeof entry.updatedAt, "number");
  });
});
