import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ItemFile } from "@collector/shared";
import {
  applyDashboardListSnapshot,
  coverNeedsResolve,
  coverPathsFromMaps,
  filterOutItemId,
  intersectCommittedWithPageIds,
  itemCoverStamp,
  itemsBodiesEqual,
  mapsFromCoverPaths,
  mergeCommittedThumbnailPaths,
  mergeCommittedThumbnailStamps,
  orderedIds,
  pruneItemIdFromDashboardLists,
  resolveDashboardGridThumbnailPath,
  shouldSkipEmptyCommit,
  snapshotToCacheEntry,
  thumbnailPathsEqual,
  type DashboardListSnapshot,
  type DashboardListSnapshotSink,
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

describe("resolveDashboardGridThumbnailPath", () => {
  it("returns committed path when resolve is not needed", () => {
    const item = stubItem("a", { thumbnail: "c.webp" });
    const paths = new Map<string, string | null>([["a", "/a"]]);
    const stamps = new Map([["a", itemCoverStamp(item)]]);
    assert.equal(
      resolveDashboardGridThumbnailPath(item, paths, stamps),
      "/a",
    );
  });

  it("returns null when committed null and stamp matches", () => {
    const item = stubItem("a");
    const paths = new Map<string, string | null>([["a", null]]);
    const stamps = new Map([["a", itemCoverStamp(item)]]);
    assert.equal(
      resolveDashboardGridThumbnailPath(item, paths, stamps),
      null,
    );
  });

  it("returns undefined while cover still needs resolve", () => {
    const item = stubItem("a");
    assert.equal(
      resolveDashboardGridThumbnailPath(item, new Map(), new Map()),
      undefined,
    );
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

describe("filterOutItemId", () => {
  it("removes matching ids and leaves others", () => {
    assert.deepEqual(
      filterOutItemId([{ id: "a" }, { id: "b" }, { id: "a" }], "a"),
      [{ id: "b" }],
    );
  });
});

describe("intersectCommittedWithPageIds", () => {
  it("returns empty when page is empty", () => {
    assert.deepEqual(
      intersectCommittedWithPageIds([stubItem("a"), stubItem("b")], []),
      [],
    );
  });

  it("keeps only ids present on the page", () => {
    const kept = intersectCommittedWithPageIds(
      [stubItem("a"), stubItem("b"), stubItem("c")],
      ["c", "a"],
    );
    assert.deepEqual(
      kept.map((item) => item.id),
      ["a", "c"],
    );
  });
});

describe("pruneItemIdFromDashboardLists", () => {
  it("is idempotent when id is absent", () => {
    const input = {
      itemIds: ["a", "b"],
      itemsById: new Map([
        ["a", stubItem("a")],
        ["b", stubItem("b")],
      ]),
      bodyStamps: new Map([
        ["a", "1"],
        ["b", "2"],
      ]),
      thumbnailPaths: new Map<string, string | null>([
        ["a", "/a"],
        ["b", null],
      ]),
      thumbnailStamps: new Map([
        ["a", "sa"],
        ["b", "sb"],
      ]),
      streamEndOffset: 2,
      totalCount: 2,
      committedItems: [stubItem("a"), stubItem("b")],
      committedTotalCount: 2,
    };
    const result = pruneItemIdFromDashboardLists("gone", input);
    assert.equal(result.removed, false);
  });

  it("removes id from lists and adjusts totals", () => {
    const input = {
      itemIds: ["a", "b", "c"],
      itemsById: new Map([
        ["a", stubItem("a")],
        ["b", stubItem("b")],
        ["c", stubItem("c")],
      ]),
      bodyStamps: new Map([
        ["a", "1"],
        ["b", "2"],
        ["c", "3"],
      ]),
      thumbnailPaths: new Map<string, string | null>([
        ["a", "/a"],
        ["b", "/b"],
        ["c", null],
      ]),
      thumbnailStamps: new Map([
        ["a", "sa"],
        ["b", "sb"],
        ["c", "sc"],
      ]),
      streamEndOffset: 3,
      totalCount: 10,
      committedItems: [stubItem("a"), stubItem("b"), stubItem("c")],
      committedTotalCount: 10,
    };
    const result = pruneItemIdFromDashboardLists("b", input);
    assert.equal(result.removed, true);
    if (!result.removed) {
      return;
    }
    assert.deepEqual(result.itemIds, ["a", "c"]);
    assert.equal(result.itemsById.has("b"), false);
    assert.equal(result.bodyStamps.has("b"), false);
    assert.equal(result.thumbnailPaths.has("b"), false);
    assert.equal(result.thumbnailStamps.has("b"), false);
    assert.equal(result.streamEndOffset, 2);
    assert.equal(result.totalCount, 9);
    assert.deepEqual(
      result.committedItems.map((item) => item.id),
      ["a", "c"],
    );
    assert.equal(result.committedTotalCount, 9);

    const again = pruneItemIdFromDashboardLists("b", {
      itemIds: result.itemIds,
      itemsById: result.itemsById,
      bodyStamps: result.bodyStamps,
      thumbnailPaths: result.thumbnailPaths,
      thumbnailStamps: result.thumbnailStamps,
      streamEndOffset: result.streamEndOffset,
      totalCount: result.totalCount,
      committedItems: result.committedItems,
      committedTotalCount: result.committedTotalCount,
    });
    assert.equal(again.removed, false);
  });
});

function recordingSnapshotSink(): {
  sink: DashboardListSnapshotSink;
  calls: Partial<Record<keyof DashboardListSnapshotSink, unknown>>;
} {
  const calls: Partial<Record<keyof DashboardListSnapshotSink, unknown>> = {};
  const sink: DashboardListSnapshotSink = {
    setItemIds: (ids) => {
      calls.setItemIds = ids;
    },
    setItemsById: (byId) => {
      calls.setItemsById = byId;
    },
    setBodyStamps: (stamps) => {
      calls.setBodyStamps = stamps;
    },
    setStreamEndOffset: (end) => {
      calls.setStreamEndOffset = end;
    },
    setTotalCount: (total) => {
      calls.setTotalCount = total;
    },
    setCommittedItems: (items) => {
      calls.setCommittedItems = items;
    },
    setCommittedTotalCount: (total) => {
      calls.setCommittedTotalCount = total;
    },
    setCommittedHasMore: (hasMore) => {
      calls.setCommittedHasMore = hasMore;
    },
    setCommittedThumbnailPaths: (paths) => {
      calls.setCommittedThumbnailPaths = paths;
    },
    setCommittedThumbnailStamps: (stamps) => {
      calls.setCommittedThumbnailStamps = stamps;
    },
  };
  return { sink, calls };
}

describe("applyDashboardListSnapshot", () => {
  it("writes working + committed fields and derives hasMore", () => {
    const item = stubItem("a");
    const snapshot: DashboardListSnapshot = {
      itemIds: ["a"],
      itemsById: new Map([["a", item]]),
      bodyStamps: new Map([["a", "s1"]]),
      streamEndOffset: 1,
      totalCount: 3,
      committedItems: [item],
      committedTotalCount: 3,
      thumbnailPaths: new Map([["a", "/a"]]),
      thumbnailStamps: new Map([["a", "ta"]]),
    };
    const { sink, calls } = recordingSnapshotSink();
    applyDashboardListSnapshot(snapshot, sink);

    assert.deepEqual(calls.setItemIds, ["a"]);
    assert.equal(
      (calls.setItemsById as Map<string, ItemFile>).get("a")?.id,
      "a",
    );
    assert.equal(
      (calls.setBodyStamps as Map<string, string>).get("a"),
      "s1",
    );
    assert.equal(calls.setStreamEndOffset, 1);
    assert.equal(calls.setTotalCount, 3);
    assert.deepEqual(
      (calls.setCommittedItems as ItemFile[]).map((row) => row.id),
      ["a"],
    );
    assert.equal(calls.setCommittedTotalCount, 3);
    assert.equal(calls.setCommittedHasMore, true);
    assert.equal(
      (calls.setCommittedThumbnailPaths as Map<string, string | null>).get(
        "a",
      ),
      "/a",
    );
    assert.equal(
      (calls.setCommittedThumbnailStamps as Map<string, string>).get("a"),
      "ta",
    );
  });

  it("sets hasMore false when stream end covers committed total", () => {
    const snapshot: DashboardListSnapshot = {
      itemIds: [],
      itemsById: new Map(),
      bodyStamps: new Map(),
      streamEndOffset: 0,
      totalCount: 0,
      committedItems: [],
      committedTotalCount: 0,
      thumbnailPaths: new Map(),
      thumbnailStamps: new Map(),
    };
    const { sink, calls } = recordingSnapshotSink();
    applyDashboardListSnapshot(snapshot, sink);
    assert.equal(calls.setCommittedHasMore, false);
  });
});
