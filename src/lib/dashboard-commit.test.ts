import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ItemFile } from "@collector/shared";
import {
  applyDashboardListSnapshot,
  coverPathsFromMaps,
  filterOutItemId,
  intersectCommittedWithPageIds,
  intersectCommittedWithPageIdsHoldPaint,
  itemCoverStamp,
  itemsBodiesEqual,
  mapsFromCoverPaths,
  orderedIds,
  pruneItemIdFromDashboardLists,
  bodyStampsForOrderedIds,
  shouldSkipCommitPaint,
  shouldSkipEmptyCommit,
  snapshotToCacheEntry,
  type DashboardListSnapshot,
  type DashboardListSnapshotSink,
} from "./dashboard-commit.ts";
import {
  coverMapsFromTriple,
  coverMapsMerge,
  coverMapsResolveForGrid,
  coverMapsUpsertPath,
} from "./cover-maps.ts";

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

  it("treats equal tag multisets as equal regardless of order", () => {
    const left = stubItem("a", { tag_ids: ["t1", "t1", "t2"] });
    const right = stubItem("a", {
      ...left,
      tag_ids: ["t2", "t1", "t1"],
    });
    assert.equal(itemsBodiesEqual([left], [right]), true);
  });

  it("rejects unequal tag multisets that share the same unique set", () => {
    const left = stubItem("a", { tag_ids: ["t1", "t1", "t2"] });
    const right = stubItem("a", {
      ...left,
      tag_ids: ["t1", "t2", "t2"],
    });
    assert.equal(itemsBodiesEqual([left], [right]), false);
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

describe("shouldSkipCommitPaint", () => {
  const ids = ["a", "b"] as const;
  const stamps = new Map([
    ["a", "100"],
    ["b", "200"],
  ]);

  it("skips when ordered ids, totalCount, and body stamps match", () => {
    assert.equal(
      shouldSkipCommitPaint({
        prevOrderedIds: [...ids],
        nextOrderedIds: [...ids],
        prevTotalCount: 10,
        nextTotalCount: 10,
        prevBodyStamps: stamps,
        nextBodyStamps: new Map(stamps),
      }),
      true,
    );
  });

  it("does not skip when ordered ids differ", () => {
    assert.equal(
      shouldSkipCommitPaint({
        prevOrderedIds: ["a", "b"],
        nextOrderedIds: ["b", "a"],
        prevTotalCount: 10,
        nextTotalCount: 10,
        prevBodyStamps: stamps,
        nextBodyStamps: new Map(stamps),
      }),
      false,
    );
  });

  it("does not skip when totalCount differs", () => {
    assert.equal(
      shouldSkipCommitPaint({
        prevOrderedIds: [...ids],
        nextOrderedIds: [...ids],
        prevTotalCount: 10,
        nextTotalCount: 11,
        prevBodyStamps: stamps,
        nextBodyStamps: new Map(stamps),
      }),
      false,
    );
  });

  it("does not skip when a body stamp differs (tag-only / presentation change)", () => {
    assert.equal(
      shouldSkipCommitPaint({
        prevOrderedIds: [...ids],
        nextOrderedIds: [...ids],
        prevTotalCount: 10,
        nextTotalCount: 10,
        prevBodyStamps: stamps,
        nextBodyStamps: new Map([
          ["a", "100"],
          ["b", "201"],
        ]),
      }),
      false,
    );
  });

  it("fails closed when a required body stamp is missing on either side", () => {
    assert.equal(
      shouldSkipCommitPaint({
        prevOrderedIds: [...ids],
        nextOrderedIds: [...ids],
        prevTotalCount: 10,
        nextTotalCount: 10,
        prevBodyStamps: new Map([["a", "100"]]),
        nextBodyStamps: stamps,
      }),
      false,
    );
    assert.equal(
      shouldSkipCommitPaint({
        prevOrderedIds: [...ids],
        nextOrderedIds: [...ids],
        prevTotalCount: 10,
        nextTotalCount: 10,
        prevBodyStamps: stamps,
        nextBodyStamps: new Map([["a", "100"]]),
      }),
      false,
    );
  });

  it("ignores stamp keys outside the ordered id window", () => {
    assert.equal(
      shouldSkipCommitPaint({
        prevOrderedIds: ["a"],
        nextOrderedIds: ["a"],
        prevTotalCount: 1,
        nextTotalCount: 1,
        prevBodyStamps: new Map([
          ["a", "100"],
          ["orphan", "x"],
        ]),
        nextBodyStamps: new Map([
          ["a", "100"],
          ["orphan", "y"],
        ]),
      }),
      true,
    );
  });
});

describe("bodyStampsForOrderedIds", () => {
  it("copies only stamps for the ordered window", () => {
    const stamps = new Map([
      ["a", "1"],
      ["b", "2"],
      ["c", "3"],
    ]);
    assert.deepEqual(
      [...bodyStampsForOrderedIds(stamps, ["c", "a"]).entries()],
      [
        ["c", "3"],
        ["a", "1"],
      ],
    );
  });

  it("omits ids with no stamp (no invented defaults)", () => {
    assert.deepEqual(
      [...bodyStampsForOrderedIds(new Map([["a", "1"]]), ["a", "b"]).entries()],
      [["a", "1"]],
    );
  });
});

describe("coverPathsFromMaps / mapsFromCoverPaths", () => {
  it("round-trips non-null path+stamp pairs", () => {
    const maps = coverMapsFromTriple(
      new Map([
        ["a", "/a"],
        ["b", null],
      ]),
      new Map([
        ["a", "s-a"],
        ["b", "s-b"],
      ]),
      new Map([
        ["a", { width: 100, height: 80 }],
        ["b", null],
      ]),
    );
    const record = coverPathsFromMaps(maps);
    assert.deepEqual(record, {
      a: { path: "/a", stamp: "s-a", width: 100, height: 80 },
    });
    const back = mapsFromCoverPaths(record);
    // Null covers are not warmed (#720 sticky-null residual).
    assert.deepEqual([...back.paths.entries()], [["a", "/a"]]);
    assert.deepEqual([...back.stamps.entries()], [["a", "s-a"]]);
    assert.deepEqual([...back.sizes.entries()], [
      ["a", { width: 100, height: 80 }],
    ]);
  });

  it("skips null cover paths when hydrating from snapshot (#720)", () => {
    const back = mapsFromCoverPaths({
      a: { path: "/a", stamp: "s-a", width: 10, height: 10 },
      b: { path: null, stamp: "s-b" },
    });
    assert.equal(back.paths.has("b"), false);
    assert.equal(back.stamps.has("b"), false);
    assert.equal(back.paths.get("a"), "/a");
    assert.deepEqual(back.sizes.get("a"), { width: 10, height: 10 });
  });

  it("skips path entries without stamps", () => {
    const maps = coverMapsFromTriple(
      new Map([["a", "/a"]]),
      new Map(),
      new Map(),
    );
    assert.deepEqual(coverPathsFromMaps(maps), {});
  });
});

describe("attach race sticky null recovery (#871)", () => {
  it("upgrades terminal null to cover path without clearing first", () => {
    const itemT1 = stubItem("a", { updated_at: "2026-01-01T00:00:00.000Z" });
    const itemT2 = stubItem("a", { updated_at: "2026-01-02T00:00:00.000Z" });
    let maps = coverMapsFromTriple(
      new Map([["a", null]]),
      new Map([["a", itemCoverStamp(itemT1)]]),
      new Map([["a", null]]),
    );
    assert.equal(coverMapsResolveForGrid(maps, itemT1).path, null);

    maps = coverMapsUpsertPath(
      maps,
      "a",
      "/media/a/cover.webp",
      itemCoverStamp(itemT2),
      { width: 320, height: 240 },
    );
    assert.equal(
      coverMapsResolveForGrid(maps, itemT2).path,
      "/media/a/cover.webp",
    );
  });

  it("merge keeps cover when a later flight resolves null", () => {
    const prev = coverMapsFromTriple(
      new Map([["a", "/media/a/cover.webp"]]),
      new Map([["a", "s"]]),
      new Map([["a", { width: 1, height: 1 }]]),
    );
    const merged = coverMapsMerge(
      prev,
      {
        paths: new Map([["a", null]]),
        stamps: new Map(),
        sizes: new Map(),
      },
      ["a"],
    );
    assert.equal(merged.paths.get("a"), "/media/a/cover.webp");
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
    assert.equal(entry.covers.paths.get("a"), "/cover-a");
    assert.equal(entry.covers.stamps.get("a"), stamp);
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
    assert.equal(entry.covers.paths.size, 0);
    assert.equal(entry.covers.stamps.size, 0);
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

describe("intersectCommittedWithPageIdsHoldPaint", () => {
  it("returns null on zero overlap when committed is non-empty", () => {
    assert.equal(
      intersectCommittedWithPageIdsHoldPaint(
        [stubItem("a"), stubItem("b")],
        ["x", "y"],
      ),
      null,
    );
  });

  it("returns subset on partial overlap", () => {
    const kept = intersectCommittedWithPageIdsHoldPaint(
      [stubItem("a"), stubItem("b"), stubItem("c")],
      ["c", "a"],
    );
    assert.notEqual(kept, null);
    assert.deepEqual(
      kept!.map((item) => item.id),
      ["a", "c"],
    );
  });

  it("returns empty when page is empty", () => {
    assert.deepEqual(
      intersectCommittedWithPageIdsHoldPaint([stubItem("a"), stubItem("b")], []),
      [],
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
      covers: coverMapsFromTriple(
        new Map<string, string | null>([
        ["a", "/a"],
        ["b", null],
      ]),
        new Map([
        ["a", "sa"],
        ["b", "sb"],
      ]),
        new Map(),
      ),
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
      covers: coverMapsFromTriple(
        new Map<string, string | null>([
        ["a", "/a"],
        ["b", "/b"],
        ["c", null],
      ]),
        new Map([
        ["a", "sa"],
        ["b", "sb"],
        ["c", "sc"],
      ]),
        new Map(),
      ),
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
    assert.equal(result.covers.paths.has("b"), false);
    assert.equal(result.covers.stamps.has("b"), false);
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
      covers: coverMapsFromTriple(
        result.covers.paths,
        result.covers.stamps,
        new Map(),
      ),
      streamEndOffset: result.streamEndOffset,
      totalCount: result.totalCount,
      committedItems: result.committedItems,
      committedTotalCount: result.committedTotalCount,
    });
    assert.equal(again.removed, false);
  });

  it("removes id present only in committed paint", () => {
    const input = {
      itemIds: ["a"],
      itemsById: new Map([["a", stubItem("a")]]),
      bodyStamps: new Map([
        ["a", "1"],
        ["orphan", "orphan-body"],
      ]),
      covers: coverMapsFromTriple(
        new Map<string, string | null>([
        ["a", "/a"],
        ["orphan", "/orphan"],
      ]),
        new Map([
        ["a", "sa"],
        ["orphan", "so"],
      ]),
        new Map(),
      ),
      streamEndOffset: 1,
      totalCount: 1,
      committedItems: [stubItem("a"), stubItem("orphan")],
      committedTotalCount: 2,
    };
    const result = pruneItemIdFromDashboardLists("orphan", input);
    assert.equal(result.removed, true);
    if (!result.removed) {
      return;
    }
    assert.deepEqual(result.itemIds, ["a"]);
    assert.equal(result.totalCount, 1);
    assert.equal(result.itemsById.has("orphan"), false);
    assert.equal(result.bodyStamps.has("orphan"), false);
    assert.equal(result.covers.paths.has("orphan"), false);
    assert.equal(result.covers.stamps.has("orphan"), false);
    assert.deepEqual(
      result.committedItems.map((item) => item.id),
      ["a"],
    );
    assert.equal(result.committedTotalCount, 1);
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
    setCoverMaps: (maps) => {
      calls.setCoverMaps = maps;
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
      covers: coverMapsFromTriple(
        new Map([["a", "/a"]]),
        new Map([["a", "ta"]]),
        new Map(),
      ),
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
      (calls.setCoverMaps as import("./cover-maps.ts").CoverMaps).paths.get(
        "a",
      ),
      "/a",
    );
    assert.equal(
      (calls.setCoverMaps as import("./cover-maps.ts").CoverMaps).stamps.get(
        "a",
      ),
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
      covers: coverMapsFromTriple(
        new Map(),
        new Map(),
        new Map(),
      ),
    };
    const { sink, calls } = recordingSnapshotSink();
    applyDashboardListSnapshot(snapshot, sink);
    assert.equal(calls.setCommittedHasMore, false);
  });
});
