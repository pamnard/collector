import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ItemFile } from "@collector/shared";
import type { DashboardQueryCacheEntry } from "../services/dashboard-query-cache.ts";
import {
  buildDashboardQueryCacheEntry,
  readInitialDashboardCacheEntry,
  stateFromDashboardCacheEntry,
} from "./dashboard-query-load.ts";
import {
  coverMapsForPersistence,
  coverMapsFromTriple,
} from "./cover-maps.ts";

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

describe("buildDashboardQueryCacheEntry", () => {
  it("snapshots ids, bodies, stamps, and thumbnails", () => {
    const byId = new Map([["a", stubItem("a")]]);
    const bodyStamps = new Map([["a", "sa"]]);
    const paths = new Map<string, string | null>([["a", "/a"]]);
    const stamps = new Map([["a", "ta"]]);
    const entry = buildDashboardQueryCacheEntry({
      itemIds: ["a"],
      itemsById: byId,
      bodyStamps,
      streamEndOffset: 1,
      totalCount: 1,
      covers: coverMapsFromTriple(
        paths,
        stamps,
        new Map(),
      ),
      now: 1234,
    });
    assert.deepEqual(entry.itemIds, ["a"]);
    assert.equal(entry.itemsById.get("a")?.id, "a");
    assert.equal(entry.bodyStamps.get("a"), "sa");
    assert.equal(entry.streamEndOffset, 1);
    assert.equal(entry.totalCount, 1);
    assert.equal(entry.covers.paths.get("a"), "/a");
    assert.equal(entry.covers.stamps.get("a"), "ta");
    assert.equal(entry.updatedAt, 1234);
    // defensive copies
    const originalIds = ["a"];
    entry.itemIds.push("b");
    assert.deepEqual(originalIds, ["a"]);
  });

  it("omits null cover paths when persisting via coverMapsForPersistence (#871)", () => {
    const byId = new Map([["a", stubItem("a")]]);
    const paths = new Map<string, string | null>([
      ["a", "/a"],
      ["b", null],
    ]);
    const stamps = new Map([
      ["a", "ta"],
      ["b", "tb"],
    ]);
    const sizes = new Map([
      ["a", { width: 10, height: 10 }],
      ["b", null],
    ]);
    const persisted = coverMapsForPersistence(
      coverMapsFromTriple(paths, stamps, sizes),
    );
    const entry = buildDashboardQueryCacheEntry({
      itemIds: ["a", "b"],
      itemsById: byId,
      bodyStamps: new Map(),
      streamEndOffset: 2,
      totalCount: 2,
      covers: persisted,
      now: 1234,
    });
    assert.equal(entry.covers.paths.get("a"), "/a");
    assert.equal(entry.covers.paths.has("b"), false);
    assert.equal(entry.covers.stamps.has("b"), false);
  });
});

describe("readInitialDashboardCacheEntry", () => {
  it("returns memory cache hit without peeking snapshot", () => {
    const cached: DashboardQueryCacheEntry = {
      itemIds: ["a"],
      itemsById: new Map([["a", stubItem("a")]]),
      bodyStamps: new Map(),
      streamEndOffset: 1,
      totalCount: 1,
      covers: coverMapsFromTriple(
        new Map(),
        new Map(),
        new Map(),
      ),
      updatedAt: 1,
    };
    let peeked = false;
    const entry = readInitialDashboardCacheEntry({
      cacheKey: "k",
      getCached: (key) => {
        assert.equal(key, "k");
        return cached;
      },
      setCached: () => {
        throw new Error("should not write on hit");
      },
      vaultId: "v1",
      peekWarmSnapshot: () => {
        peeked = true;
        return null;
      },
      snapshotToEntry: () => {
        throw new Error("unused");
      },
    });
    assert.equal(entry, cached);
    assert.equal(peeked, false);
  });

  it("warms from snapshot when cache miss and vault present", () => {
    const warmEntry: DashboardQueryCacheEntry = {
      itemIds: ["w"],
      itemsById: new Map([["w", stubItem("w")]]),
      bodyStamps: new Map(),
      streamEndOffset: 1,
      totalCount: 1,
      covers: coverMapsFromTriple(
        new Map(),
        new Map(),
        new Map(),
      ),
      updatedAt: 9,
    };
    const store = new Map<string, DashboardQueryCacheEntry>();
    const entry = readInitialDashboardCacheEntry({
      cacheKey: "k2",
      getCached: (key) => store.get(key) ?? null,
      setCached: (key, value) => {
        store.set(key, value);
      },
      vaultId: "v1",
      peekWarmSnapshot: () => ({ warm: true }),
      snapshotToEntry: (snap) => {
        assert.deepEqual(snap, { warm: true });
        return warmEntry;
      },
    });
    assert.equal(entry, warmEntry);
    assert.equal(store.get("k2"), warmEntry);
  });

  it("returns null when miss and no vault", () => {
    const entry = readInitialDashboardCacheEntry({
      cacheKey: "k3",
      getCached: () => null,
      setCached: () => {},
      vaultId: null,
      peekWarmSnapshot: () => {
        throw new Error("should not peek");
      },
      snapshotToEntry: () => {
        throw new Error("unused");
      },
    });
    assert.equal(entry, null);
  });
});

describe("stateFromDashboardCacheEntry", () => {
  it("orders committed items and materializes working copies of list containers", () => {
    const item = stubItem("a");
    const entry: DashboardQueryCacheEntry = {
      itemIds: ["a"],
      itemsById: new Map([["a", item]]),
      bodyStamps: new Map([["a", "sa"]]),
      streamEndOffset: 1,
      totalCount: 2,
      covers: coverMapsFromTriple(
        new Map([["a", "/a"]]),
        new Map([["a", "ta"]]),
        new Map(),
      ),
      updatedAt: 1,
    };
    const state = stateFromDashboardCacheEntry(entry);
    assert.equal(state.ordered[0]?.id, "a");
    assert.equal(state.hasMore, true);
    assert.notEqual(state.itemIds, entry.itemIds);
    assert.notEqual(state.itemsById, entry.itemsById);
    assert.notEqual(state.bodyStamps, entry.bodyStamps);
    state.itemIds.push("b");
    state.itemsById.set("b", stubItem("b"));
    state.covers.paths.set("b", "/b");
    assert.deepEqual(entry.itemIds, ["a"]);
    assert.equal(entry.itemsById.has("b"), false);
    assert.equal(entry.covers.paths.has("b"), false);
  });
});
