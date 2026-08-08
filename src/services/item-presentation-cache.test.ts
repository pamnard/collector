import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import type { ItemFile } from "@collector/shared";
import {
  clearDashboardQueryCache,
  dashboardQueryCacheKey,
  getDashboardQueryCache,
  setDashboardQueryCache,
} from "./dashboard-query-cache.ts";
import { invalidateItemPresentationCache } from "./item-presentation-cache.ts";

describe("invalidateItemPresentationCache", () => {
  beforeEach(() => {
    clearDashboardQueryCache();
  });

  it("clears dashboard query cache entries", () => {
    const key = dashboardQueryCacheKey("folder:a", "");
    setDashboardQueryCache(key, {
      itemIds: ["1"],
      itemsById: new Map([["1", { id: "1" } as ItemFile]]),
      streamEndOffset: 1,
      totalCount: 1,
      thumbnailPaths: new Map(),
      thumbnailStamps: new Map(),
      updatedAt: Date.now(),
    });
    invalidateItemPresentationCache();
    assert.equal(getDashboardQueryCache(key), null);
  });
});
