import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import type { ItemFile } from "@collector/shared";
import {
  DASHBOARD_QUERY_CACHE_MAX,
  clearDashboardQueryCache,
  dashboardQueryCacheKey,
  dashboardQueryCacheKeysForTests,
  getDashboardQueryCache,
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
    streamEndOffset: partial.streamEndOffset ?? partial.itemIds.length,
    totalCount: partial.totalCount ?? partial.itemIds.length,
    thumbnailPaths: partial.thumbnailPaths ?? new Map(),
    updatedAt: partial.updatedAt ?? Date.now(),
  };
}

describe("dashboardQueryCacheKey", () => {
  it("trims search", () => {
    assert.equal(dashboardQueryCacheKey("folder:a", "  q  "), "folder:a|q");
  });
});

describe("dashboard query cache LRU", () => {
  beforeEach(() => {
    clearDashboardQueryCache();
  });

  it("stores and returns a clone on get", () => {
    const key = dashboardQueryCacheKey("folder:a", "");
    setDashboardQueryCache(key, entry({ itemIds: ["1", "2"] }));
    const got = getDashboardQueryCache(key);
    assert.ok(got);
    assert.deepEqual(got.itemIds, ["1", "2"]);
    got.itemIds.push("3");
    assert.deepEqual(getDashboardQueryCache(key)?.itemIds, ["1", "2"]);
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
    assert.deepEqual(b?.itemIds, []);
    assert.equal(b?.totalCount, 0);
  });
});
