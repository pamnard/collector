import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ItemFile } from "@collector/shared";
import {
  coverNeedsResolve,
  coverPathsFromMaps,
  itemCoverStamp,
  itemsBodiesEqual,
  mapsFromCoverPaths,
  mergeCommittedThumbnailPaths,
  mergeCommittedThumbnailStamps,
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
    description: "",
    url: null,
    content_type: "note",
    tag_ids: [],
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

describe("itemCoverStamp", () => {
  it("joins thumbnail and updated_at", () => {
    assert.equal(
      itemCoverStamp({ thumbnail: "c.webp", updated_at: "t1" }),
      "c.webp:t1",
    );
    assert.equal(
      itemCoverStamp({ thumbnail: null, updated_at: "t1" }),
      ":t1",
    );
  });
});

describe("coverNeedsResolve", () => {
  it("needs resolve when path key is missing", () => {
    const item = stubItem("a");
    assert.equal(
      coverNeedsResolve(item, new Map(), new Map()),
      true,
    );
  });

  it("needs resolve on stamp mismatch", () => {
    const item = stubItem("a", { thumbnail: "c.webp" });
    const paths = new Map<string, string | null>([["a", "/a"]]);
    const stamps = new Map([["a", "old:stamp"]]);
    assert.equal(coverNeedsResolve(item, paths, stamps), true);
  });

  it("skips resolve when path and stamp match", () => {
    const item = stubItem("a", { thumbnail: "c.webp" });
    const paths = new Map<string, string | null>([["a", "/a"]]);
    const stamps = new Map([["a", itemCoverStamp(item)]]);
    assert.equal(coverNeedsResolve(item, paths, stamps), false);
  });

  it("treats explicit null path with matching stamp as resolved", () => {
    const item = stubItem("a");
    const paths = new Map<string, string | null>([["a", null]]);
    const stamps = new Map([["a", itemCoverStamp(item)]]);
    assert.equal(coverNeedsResolve(item, paths, stamps), false);
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
    const a = stubItem("a", {
      title: "A",
      description: "d",
      url: null,
      content_type: "link",
      tag_ids: ["t1"],
    });
    const b = stubItem("a", {
      title: "A",
      description: "d",
      url: null,
      content_type: "link",
      tag_ids: ["t1"],
    });
    const c = stubItem("a", {
      title: "B",
      description: "d",
      url: null,
      content_type: "link",
      tag_ids: ["t1"],
    });
    assert.equal(itemsBodiesEqual([a], [b]), true);
    assert.equal(itemsBodiesEqual([a], [c]), false);
    assert.equal(itemsBodiesEqual([a], []), false);
  });

  it("detects description url content_type and tag_ids changes", () => {
    const base = stubItem("a", {
      title: "A",
      description: "d",
      url: "https://a",
      content_type: "link",
      tag_ids: ["t1", "t2"],
    });
    assert.equal(
      itemsBodiesEqual(
        [base],
        [stubItem("a", { ...base, description: "other" })],
      ),
      false,
    );
    assert.equal(
      itemsBodiesEqual([base], [stubItem("a", { ...base, url: null })]),
      false,
    );
    assert.equal(
      itemsBodiesEqual(
        [base],
        [stubItem("a", { ...base, content_type: "note" })],
      ),
      false,
    );
    assert.equal(
      itemsBodiesEqual(
        [base],
        [stubItem("a", { ...base, tag_ids: ["t2", "t1"] })],
      ),
      true,
    );
    assert.equal(
      itemsBodiesEqual(
        [base],
        [stubItem("a", { ...base, tag_ids: ["t1"] })],
      ),
      false,
    );
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

describe("mergeCommittedThumbnailStamps", () => {
  it("merges and prunes stamps", () => {
    const prev = new Map([
      ["a", "old"],
      ["gone", "x"],
    ]);
    const next = new Map([["a", "new"], ["b", "b"]]);
    const merged = mergeCommittedThumbnailStamps(prev, next, ["a", "b"]);
    assert.deepEqual([...merged.entries()], [
      ["a", "new"],
      ["b", "b"],
    ]);
  });
});

describe("coverPathsFromMaps / mapsFromCoverPaths", () => {
  it("round-trips path+stamp pairs", () => {
    const paths = new Map<string, string | null>([
      ["a", "/a"],
      ["b", null],
    ]);
    const stamps = new Map([
      ["a", "s-a"],
      ["b", "s-b"],
    ]);
    const record = coverPathsFromMaps(paths, stamps);
    assert.deepEqual(record, {
      a: { path: "/a", stamp: "s-a" },
      b: { path: null, stamp: "s-b" },
    });
    const back = mapsFromCoverPaths(record);
    assert.deepEqual([...back.thumbnailPaths.entries()], [...paths.entries()]);
    assert.deepEqual([...back.thumbnailStamps.entries()], [...stamps.entries()]);
  });

  it("skips path entries without stamps", () => {
    const paths = new Map<string, string | null>([["a", "/a"]]);
    const stamps = new Map<string, string>();
    assert.deepEqual(coverPathsFromMaps(paths, stamps), {});
  });
});

describe("snapshotToCacheEntry", () => {
  it("maps snapshot fields including cover_paths", () => {
    const item = stubItem("a", { thumbnail: "c.webp" });
    const stamp = itemCoverStamp(item);
    const entry = snapshotToCacheEntry({
      schema_version: 3,
      vault_id: "00000000-0000-4000-8000-000000000001",
      nav_filter: "all",
      search: "",
      sort_key: "created_at",
      sort_dir: "desc",
      item_ids: ["a"],
      items: [item],
      body_stamps: { a: "42" },
      stream_end_offset: 1,
      total_count: 5,
      cover_paths: {
        a: { path: "/cover-a", stamp },
      },
      saved_at: "2026-01-01T00:00:00.000Z",
    });
    assert.deepEqual(entry.itemIds, ["a"]);
    assert.equal(entry.itemsById.get("a"), item);
    assert.equal(entry.bodyStamps.get("a"), "42");
    assert.equal(entry.streamEndOffset, 1);
    assert.equal(entry.totalCount, 5);
    assert.equal(entry.thumbnailPaths.get("a"), "/cover-a");
    assert.equal(entry.thumbnailStamps.get("a"), stamp);
    assert.equal(typeof entry.updatedAt, "number");
  });

  it("defaults empty cover maps when cover_paths absent", () => {
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
      body_stamps: {},
      stream_end_offset: 1,
      total_count: 5,
      cover_paths: {},
      saved_at: "2026-01-01T00:00:00.000Z",
    });
    assert.equal(entry.thumbnailPaths.size, 0);
    assert.equal(entry.thumbnailStamps.size, 0);
    assert.equal(entry.bodyStamps.size, 0);
  });
});
