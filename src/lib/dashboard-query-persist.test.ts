import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ItemFile } from "@collector/shared";
import { emptyCoverMaps } from "./cover-maps.ts";
import {
  buildDashboardQueryPersistPayload,
  scheduleDashboardQueryPersist,
  shouldScheduleDashboardQueryPersist,
} from "./dashboard-query-persist.ts";

function stubItem(id: string): ItemFile {
  return {
    id,
    title: id,
    description: "",
    url: null,
    content_type: "note",
    tag_ids: [],
    updated_at: "2026-01-01T00:00:00.000Z",
    thumbnail: null,
  } as ItemFile;
}

describe("buildDashboardQueryPersistPayload (#929)", () => {
  it("builds snapshot fields and cache entry from working state", () => {
    const item = stubItem("a");
    const payload = buildDashboardQueryPersistPayload({
      vaultId: "v1",
      filter: "all",
      searchQuery: "q",
      sort: { key: "updated_at", dir: "desc" },
      itemIds: ["a"],
      workingItems: [item],
      itemsById: new Map([["a", item]]),
      totalCount: 1,
      streamEndOffset: 1,
      coverMaps: emptyCoverMaps(),
      bodyStamps: new Map([["a", "stamp"]]),
    });
    assert.equal(payload.snapshot.vaultId, "v1");
    assert.equal(payload.snapshot.search, "q");
    assert.deepEqual(payload.snapshot.itemIds, ["a"]);
    assert.equal(payload.snapshot.bodyStamps?.a, "stamp");
    assert.deepEqual(payload.cacheEntry.itemIds, ["a"]);
    assert.equal(payload.cacheEntry.totalCount, 1);
  });
});

describe("shouldScheduleDashboardQueryPersist (#929)", () => {
  it("requires vault, idle, and non-empty working window", () => {
    assert.equal(
      shouldScheduleDashboardQueryPersist({
        vaultId: "v",
        isLoading: false,
        itemIdsLength: 1,
        workingItemsLength: 1,
      }),
      true,
    );
    assert.equal(
      shouldScheduleDashboardQueryPersist({
        vaultId: null,
        isLoading: false,
        itemIdsLength: 1,
        workingItemsLength: 1,
      }),
      false,
    );
    assert.equal(
      shouldScheduleDashboardQueryPersist({
        vaultId: "v",
        isLoading: true,
        itemIdsLength: 1,
        workingItemsLength: 1,
      }),
      false,
    );
  });
});

describe("scheduleDashboardQueryPersist (#929)", () => {
  it("fires persist + cache after debounce and cancel clears timer", async () => {
    const calls: string[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cancel = scheduleDashboardQueryPersist({
      delayMs: 5,
      setTimer: (t) => {
        timer = t;
      },
      clearTimer: () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
          calls.push("clear");
        }
      },
      getCoverMaps: () => emptyCoverMaps(),
      payloadInput: {
        vaultId: "v1",
        filter: "all",
        searchQuery: "",
        sort: { key: "updated_at", dir: "desc" },
        itemIds: ["a"],
        workingItems: [stubItem("a")],
        itemsById: new Map([["a", stubItem("a")]]),
        totalCount: 1,
        streamEndOffset: 1,
        bodyStamps: new Map(),
      },
      snapshotPort: {
        buildDashboardSnapshot: (input) => {
          calls.push(`build:${input.vaultId}`);
          return input as never;
        },
        persistDashboardSnapshot: async () => {
          calls.push("persist");
        },
      },
      setCached: (key) => {
        calls.push(`cache:${key}`);
      },
      queryKey: "qk",
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(calls.includes("build:v1"));
    assert.ok(calls.includes("persist"));
    assert.ok(calls.includes("cache:qk"));
    cancel();
  });
});
