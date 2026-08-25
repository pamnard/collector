import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import type { ItemFile } from "@collector/shared";
import {
  DASHBOARD_QUERY_CACHE_MAX,
  applyDashboardQueryCacheCoverFlightPatch,
  clearDashboardQueryCache,
  dashboardQueryCacheKey,
  dashboardQueryCacheKeysForTests,
  getDashboardQueryCache,
  patchDashboardQueryCacheCovers,
  removeItemIdFromDashboardQueryCache,
  setDashboardQueryCache,
  type DashboardQueryCacheEntry,
} from "./dashboard-query-cache.ts";

function stubItem(id: string): ItemFile {
  return { id } as ItemFile;
}

function entry(
  partial: Partial<DashboardQueryCacheEntry> & { itemIds: string[] },
): DashboardQueryCacheEntry {
  const itemsById = partial.itemsById
    ? new Map(partial.itemsById)
    : new Map(partial.itemIds.map((id) => [id, stubItem(id)]));
  return {
    itemIds: [...partial.itemIds],
    itemsById,
    bodyStamps: partial.bodyStamps ?? new Map(),
    streamEndOffset: partial.streamEndOffset ?? partial.itemIds.length,
    totalCount: partial.totalCount ?? partial.itemIds.length,
    thumbnailPaths: partial.thumbnailPaths ?? new Map(),
    thumbnailStamps: partial.thumbnailStamps ?? new Map(),
    thumbnailSizes: partial.thumbnailSizes ?? new Map(),
    updatedAt: partial.updatedAt ?? Date.now(),
  };
}

describe("dashboardQueryCacheKey", () => {
  it("trims search", () => {
    assert.equal(
      dashboardQueryCacheKey("folder:a", "  q  "),
      "folder:a|q|created_at|desc",
    );
    assert.equal(
      dashboardQueryCacheKey("all", "", "title", "asc"),
      "all||title|asc",
    );
  });
});

describe("dashboard query cache LRU", () => {
  beforeEach(() => {
    clearDashboardQueryCache();
  });

  it("get returns the sealed store entry without cloning containers", () => {
    const key = dashboardQueryCacheKey("folder:a", "");
    setDashboardQueryCache(key, entry({ itemIds: ["1", "2"] }));
    const first = getDashboardQueryCache(key);
    const second = getDashboardQueryCache(key);
    assert.ok(first);
    assert.equal(first, second);
    assert.equal(first.itemIds, second.itemIds);
    assert.equal(first.itemsById, second.itemsById);
    assert.equal(first.bodyStamps, second.bodyStamps);
    assert.equal(first.thumbnailPaths, second.thumbnailPaths);
    assert.equal(first.thumbnailStamps, second.thumbnailStamps);
  });

  it("sealed maps from get support size, get, and has", () => {
    const key = dashboardQueryCacheKey("folder:a", "");
    setDashboardQueryCache(
      key,
      entry({
        itemIds: ["1", "2"],
        bodyStamps: new Map([["1", "s1"]]),
        thumbnailPaths: new Map([["1", "/a"]]),
        thumbnailStamps: new Map([["1", "t:a"]]),
        thumbnailSizes: new Map(),
      }),
    );
    const got = getDashboardQueryCache(key);
    assert.ok(got);
    assert.equal(got.itemsById.size, 2);
    assert.equal(got.itemsById.get("1")?.id, "1");
    assert.equal(got.itemsById.has("2"), true);
    assert.equal(got.itemsById.has("missing"), false);
    assert.equal(got.bodyStamps.size, 1);
    assert.equal(got.bodyStamps.get("1"), "s1");
    assert.equal(got.thumbnailPaths.size, 1);
    assert.equal(got.thumbnailPaths.get("1"), "/a");
    assert.equal(got.thumbnailStamps.has("1"), true);
  });

  it("mutating a returned entry does not corrupt the store", () => {
    const key = dashboardQueryCacheKey("folder:a", "");
    setDashboardQueryCache(key, entry({ itemIds: ["1", "2"] }));
    const got = getDashboardQueryCache(key);
    assert.ok(got);
    assert.throws(() => {
      got.itemIds.push("3");
    });
    assert.throws(() => {
      got.thumbnailPaths.set("1", "/poison");
    });
    assert.deepEqual(getDashboardQueryCache(key)?.itemIds, ["1", "2"]);
    assert.equal(getDashboardQueryCache(key)?.thumbnailPaths.has("1"), false);
  });

  it("set clones caller input so later mutation does not poison the store", () => {
    const key = dashboardQueryCacheKey("folder:a", "");
    const input = entry({
      itemIds: ["1"],
      thumbnailPaths: new Map([["1", "/a"]]),
    });
    setDashboardQueryCache(key, input);
    input.itemIds.push("2");
    input.thumbnailPaths.set("1", "/poison");
    const stored = getDashboardQueryCache(key);
    assert.deepEqual(stored?.itemIds, ["1"]);
    assert.equal(stored?.thumbnailPaths.get("1"), "/a");
  });

  it("patchDashboardQueryCacheCovers shares list containers and replaces only covers", () => {
    const key = dashboardQueryCacheKey("folder:a", "");
    setDashboardQueryCache(
      key,
      entry({
        itemIds: ["1", "2", "3"],
        bodyStamps: new Map([["1", "s1"], ["2", "s2"]]),
        thumbnailPaths: new Map([["1", "/old"]]),
        thumbnailStamps: new Map([["1", "t:old"]]),
        thumbnailSizes: new Map(),
      }),
    );
    const before = getDashboardQueryCache(key);
    assert.ok(before);

    assert.equal(
      patchDashboardQueryCacheCovers(
        key,
        new Map([
          ["1", "/new"],
          ["2", "/two"],
        ]),
        new Map([
          ["1", "t:new"],
          ["2", "t:two"],
        ]),
        new Map([
          ["1", { width: 10, height: 10 }],
          ["2", { width: 20, height: 20 }],
        ]),
      ),
      true,
    );

    const after = getDashboardQueryCache(key);
    assert.ok(after);
    assert.equal(after.itemIds, before.itemIds);
    assert.equal(after.itemsById, before.itemsById);
    assert.equal(after.bodyStamps, before.bodyStamps);
    assert.notEqual(after.thumbnailPaths, before.thumbnailPaths);
    assert.notEqual(after.thumbnailStamps, before.thumbnailStamps);
    assert.equal(after.thumbnailPaths.get("1"), "/new");
    assert.equal(after.thumbnailPaths.get("2"), "/two");
    assert.equal(after.thumbnailStamps.get("1"), "t:new");
    assert.equal(after.streamEndOffset, before.streamEndOffset);
    assert.equal(after.totalCount, before.totalCount);
  });

  it("patchDashboardQueryCacheCovers returns false when key is absent", () => {
    assert.equal(
      patchDashboardQueryCacheCovers(
        "missing|",
        new Map([["1", "/a"]]),
        new Map([["1", "t:a"]]),
      ),
      false,
    );
  });

  it("applyDashboardQueryCacheCoverFlightPatch skips foreign key after live key changes", () => {
    const flightKey = dashboardQueryCacheKey("folder:old", "");
    const foreignKey = dashboardQueryCacheKey("folder:new", "");
    setDashboardQueryCache(
      flightKey,
      entry({
        itemIds: ["old"],
        thumbnailPaths: new Map([["old", "/old"]]),
      }),
    );
    setDashboardQueryCache(
      foreignKey,
      entry({
        itemIds: ["new"],
        thumbnailPaths: new Map([["new", "/new-before"]]),
      }),
    );

    let liveKey = foreignKey;
    const result = applyDashboardQueryCacheCoverFlightPatch({
      flightKey,
      flightVersion: 1,
      getLiveKey: () => liveKey,
      getLiveVersion: () => 1,
      thumbnailPaths: new Map([["old", "/poison"]]),
      thumbnailStamps: new Map([["old", "t:poison"]]),
      thumbnailSizes: new Map(),
      rewriteFull: () => {
        throw new Error("rewriteFull must not run when live key diverged");
      },
    });

    assert.equal(result, "skipped");
    assert.equal(
      getDashboardQueryCache(foreignKey)?.thumbnailPaths.get("new"),
      "/new-before",
    );
    assert.equal(
      getDashboardQueryCache(flightKey)?.thumbnailPaths.get("old"),
      "/old",
    );
  });

  it("applyDashboardQueryCacheCoverFlightPatch rewrites when flight key was LRU-evicted", () => {
    const flightKey = dashboardQueryCacheKey("folder:a", "");
    const result = applyDashboardQueryCacheCoverFlightPatch({
      flightKey,
      flightVersion: 3,
      getLiveKey: () => flightKey,
      getLiveVersion: () => 3,
      thumbnailPaths: new Map([["1", "/rewritten"]]),
      thumbnailStamps: new Map([["1", "t:rewritten"]]),
      thumbnailSizes: new Map(),
      rewriteFull: () => {
        setDashboardQueryCache(
          flightKey,
          entry({
            itemIds: ["1"],
            thumbnailPaths: new Map([["1", "/rewritten"]]),
            thumbnailStamps: new Map([["1", "t:rewritten"]]),
            thumbnailSizes: new Map(),
          }),
        );
      },
    });

    assert.equal(result, "rewritten");
    assert.equal(
      getDashboardQueryCache(flightKey)?.thumbnailPaths.get("1"),
      "/rewritten",
    );
  });

  it("evicts oldest when over max", () => {
    for (let i = 0; i < DASHBOARD_QUERY_CACHE_MAX + 2; i++) {
      setDashboardQueryCache(`k${i}|`, entry({ itemIds: [`id-${i}`] }));
    }
    const keys = dashboardQueryCacheKeysForTests();
    assert.equal(keys.length, DASHBOARD_QUERY_CACHE_MAX);
    assert.equal(getDashboardQueryCache("k0|"), null);
    assert.equal(getDashboardQueryCache("k1|"), null);
    assert.ok(getDashboardQueryCache("k2|"));
    assert.ok(getDashboardQueryCache(`k${DASHBOARD_QUERY_CACHE_MAX + 1}|`));
  });

  it("get refreshes LRU order", () => {
    setDashboardQueryCache("a|", entry({ itemIds: ["a"] }));
    setDashboardQueryCache("b|", entry({ itemIds: ["b"] }));
    getDashboardQueryCache("a|");
    for (let i = 0; i < DASHBOARD_QUERY_CACHE_MAX - 1; i++) {
      setDashboardQueryCache(`n${i}|`, entry({ itemIds: [`n${i}`] }));
    }
    assert.ok(getDashboardQueryCache("a|"));
    assert.equal(getDashboardQueryCache("b|"), null);
  });

  it("removeItemId strips from all entries", () => {
    setDashboardQueryCache(
      "a|",
      entry({
        itemIds: ["x", "y"],
        totalCount: 2,
        thumbnailPaths: new Map([["x", "/x"], ["y", "/y"]]),
        thumbnailStamps: new Map([["x", "t:x"], ["y", "t:y"]]),
        thumbnailSizes: new Map(),
      }),
    );
    setDashboardQueryCache(
      "b|",
      entry({ itemIds: ["x"], totalCount: 1 }),
    );
    removeItemIdFromDashboardQueryCache("x");
    const a = getDashboardQueryCache("a|");
    const b = getDashboardQueryCache("b|");
    assert.deepEqual(a?.itemIds, ["y"]);
    assert.equal(a?.totalCount, 1);
    assert.equal(a?.thumbnailPaths.has("x"), false);
    assert.equal(a?.thumbnailStamps.has("x"), false);
    assert.deepEqual(b?.itemIds, []);
    assert.equal(b?.totalCount, 0);
  });
});
