import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ItemFile } from "@collector/shared";
import {
  coverMapsClear,
  coverMapsForPersistence,
  coverMapsFromTriple,
  coverMapsHydrate,
  coverMapsIntersect,
  coverMapsMerge,
  coverMapsNeedsResolve,
  coverMapsResolveForGrid,
  coverMapsStripStickyNulls,
  coverMapsToPersistenceRecord,
  coverMapsUpsertPath,
  emptyCoverMaps,
  itemCoverStamp,
  orderedIds,
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

describe("CoverMaps", () => {
  it("orderedIds maps item ids in order", () => {
    assert.deepEqual(orderedIds([stubItem("a"), stubItem("b")]), ["a", "b"]);
  });

  it("needsResolve when path key is missing", () => {
    assert.equal(
      coverMapsNeedsResolve(emptyCoverMaps(), stubItem("a")),
      true,
    );
  });

  it("needsResolve when path exists but size key is missing (#799)", () => {
    const item = stubItem("a");
    const maps = coverMapsFromTriple(
      new Map([["a", "/cover.webp"]]),
      new Map([["a", itemCoverStamp(item)]]),
      new Map(),
    );
    assert.equal(coverMapsNeedsResolve(maps, item), true);
    // Do not SWR a cover path without WxH — that paints 1×1 decode then jumps.
    assert.deepEqual(coverMapsResolveForGrid(maps, item), {
      path: undefined,
      size: undefined,
    });
  });

  it("needsResolve when path exists but size is null (key present)", () => {
    const item = stubItem("a");
    const maps = coverMapsFromTriple(
      new Map([["a", "/cover.webp"]]),
      new Map([["a", itemCoverStamp(item)]]),
      new Map([["a", null]]),
    );
    assert.equal(coverMapsNeedsResolve(maps, item), true);
    assert.deepEqual(coverMapsResolveForGrid(maps, item), {
      path: undefined,
      size: undefined,
    });
  });

  it("treats sticky null with matching stamp/size as resolved", () => {
    const item = stubItem("a");
    const maps = coverMapsFromTriple(
      new Map([["a", null]]),
      new Map([["a", itemCoverStamp(item)]]),
      new Map([["a", null]]),
    );
    assert.equal(coverMapsNeedsResolve(maps, item), false);
  });

  it("resolveForGrid keeps path+size while stamp is stale (#871 SWR)", () => {
    const item = stubItem("a", { updated_at: "2026-01-02T00:00:00.000Z" });
    const maps = coverMapsFromTriple(
      new Map([["a", "/cover"]]),
      new Map([["a", "old:stamp"]]),
      new Map([["a", { width: 10, height: 10 }]]),
    );
    assert.equal(coverMapsNeedsResolve(maps, item), true);
    assert.deepEqual(coverMapsResolveForGrid(maps, item), {
      path: "/cover",
      size: { width: 10, height: 10 },
    });
  });

  it("resolveForGrid does not SWR path when stamp stale and size missing", () => {
    const item = stubItem("a", { updated_at: "2026-01-02T00:00:00.000Z" });
    const maps = coverMapsFromTriple(
      new Map([["a", "/cover"]]),
      new Map([["a", "old:stamp"]]),
      new Map(),
    );
    assert.equal(coverMapsNeedsResolve(maps, item), true);
    assert.deepEqual(coverMapsResolveForGrid(maps, item), {
      path: undefined,
      size: undefined,
    });
  });

  it("merge never downgrades path to null (#871)", () => {
    const prev = coverMapsFromTriple(
      new Map([["a", "/cover"]]),
      new Map([["a", "s"]]),
      new Map([["a", { width: 1, height: 1 }]]),
    );
    const merged = coverMapsMerge(
      prev,
      {
        paths: new Map([["a", null]]),
        stamps: new Map([["a", "s2"]]),
        sizes: new Map([["a", null]]),
      },
      ["a"],
    );
    assert.equal(merged.paths.get("a"), "/cover");
    assert.equal(merged.stamps.get("a"), "s");
    assert.deepEqual(merged.sizes.get("a"), { width: 1, height: 1 });
  });

  it("merge upgrades paths and prunes ids outside ordered window", () => {
    const prev = coverMapsFromTriple(
      new Map([
        ["a", "/old-a"],
        ["gone", "/x"],
      ]),
      new Map([
        ["a", "old"],
        ["gone", "x"],
      ]),
      new Map([
        ["a", null],
        ["gone", null],
      ]),
    );
    const merged = coverMapsMerge(
      prev,
      {
        paths: new Map([
          ["a", "/new-a"],
          ["b", null],
        ]),
        stamps: new Map([
          ["a", "new"],
          ["b", "b"],
        ]),
        sizes: new Map([
          ["a", null],
          ["b", null],
        ]),
      },
      ["a", "b"],
    );
    assert.deepEqual([...merged.paths.entries()], [
      ["a", "/new-a"],
      ["b", null],
    ]);
    assert.equal(merged.paths.has("gone"), false);
    assert.deepEqual([...merged.stamps.entries()], [
      ["a", "new"],
      ["b", "b"],
    ]);
  });

  it("forPersistence and hydrate omit null (#720)", () => {
    const maps = coverMapsFromTriple(
      new Map([
        ["a", "/a"],
        ["b", null],
      ]),
      new Map([
        ["a", "sa"],
        ["b", "sb"],
      ]),
      new Map([
        ["a", { width: 2, height: 2 }],
        ["b", null],
      ]),
    );
    const persisted = coverMapsForPersistence(maps);
    assert.equal(persisted.paths.has("b"), false);
    assert.equal(persisted.paths.get("a"), "/a");

    const record = coverMapsToPersistenceRecord(maps);
    assert.equal(record.b, undefined);
    const hydrated = coverMapsHydrate({
      a: { path: "/a", stamp: "sa", width: 2, height: 2 },
      b: { path: null, stamp: "sb", width: null, height: null },
    });
    assert.equal(hydrated.paths.has("b"), false);
  });

  it("stripStickyNulls reopens holes without clearing positive paths", () => {
    const itemA = stubItem("a");
    const itemB = stubItem("b", { thumbnail: "c.webp" });
    const maps = coverMapsFromTriple(
      new Map([
        ["a", null],
        ["b", "/b"],
      ]),
      new Map([
        ["a", itemCoverStamp(itemA)],
        ["b", itemCoverStamp(itemB)],
      ]),
      new Map([
        ["a", null],
        ["b", { width: 1, height: 1 }],
      ]),
    );
    const { maps: next, stripped } = coverMapsStripStickyNulls(maps, [
      itemA,
      itemB,
    ]);
    assert.equal(stripped, true);
    assert.equal(next.paths.has("a"), false);
    assert.equal(next.paths.get("b"), "/b");
  });

  it("clear / intersect", () => {
    const maps = coverMapsFromTriple(
      new Map([
        ["a", "/a"],
        ["b", "/b"],
      ]),
      new Map([
        ["a", "sa"],
        ["b", "sb"],
      ]),
      new Map([
        ["a", null],
        ["b", null],
      ]),
    );
    const cleared = coverMapsClear(maps, "a");
    assert.equal(cleared.paths.has("a"), false);
    const intersected = coverMapsIntersect(maps, ["b"]);
    assert.equal(intersected.paths.has("a"), false);
    assert.equal(intersected.paths.get("b"), "/b");
  });

  it("upsertPath upgrades without clearing first", () => {
    const maps = coverMapsFromTriple(
      new Map([["a", null]]),
      new Map([["a", "old"]]),
      new Map([["a", null]]),
    );
    const next = coverMapsUpsertPath(
      maps,
      "a",
      "/cover.webp",
      "new",
      { width: 10, height: 10 },
    );
    assert.equal(next.paths.get("a"), "/cover.webp");
  });
});
