import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ItemFile } from "@collector/shared";
import {
  coverMapsFromTriple,
  coverMapsNeedsResolve,
  coverMapsResolveForGrid,
  emptyCoverMaps,
  itemCoverStamp,
  type CoverMaps,
} from "./cover-maps.ts";
import { createCoverController } from "./cover-controller.ts";

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

describe("CoverController SoT orchestration (#874 / #871)", () => {
  it("owns maps: sticky-null → refresh → path → stamp round-trip", async () => {
    const item = stubItem("a", { thumbnail: null });
    const stamp = itemCoverStamp(item);
    const itemsById = new Map([["a", item]]);
    const requestVersion = 1;

    const controller = createCoverController(
      {
        resolveProgressive: async (items, options) => {
          for (const row of items) {
            options.onResolved?.(row.id, "/vault/a/cover.webp", {
              width: 40,
              height: 30,
            });
          }
        },
        getRequestVersion: () => requestVersion,
        getQueryKey: () => "k",
        getItem: (id) => itemsById.get(id),
      },
      coverMapsFromTriple(
        new Map([["a", null]]),
        new Map([["a", stamp]]),
        new Map([["a", null]]),
      ),
    );

    assert.equal(coverMapsNeedsResolve(controller.getMaps(), item), false);

    controller.probeStickyNulls([item]);
    await Promise.resolve();

    assert.equal(controller.getMaps().paths.get("a"), "/vault/a/cover.webp");
    assert.deepEqual(coverMapsResolveForGrid(controller.getMaps(), item), {
      path: "/vault/a/cover.webp",
      size: { width: 40, height: 30 },
    });

    const bumped = stubItem("a", {
      thumbnail: null,
      updated_at: "2026-01-02T00:00:00.000Z",
    });
    itemsById.set("a", bumped);
    assert.equal(coverMapsNeedsResolve(controller.getMaps(), bumped), true);
    assert.equal(
      coverMapsResolveForGrid(controller.getMaps(), bumped).path,
      "/vault/a/cover.webp",
    );

    await controller.beginFlight(requestVersion, [bumped], {
      blockOnCovers: true,
    });
    assert.equal(controller.getMaps().paths.get("a"), "/vault/a/cover.webp");
    assert.equal(
      controller.getMaps().stamps.get("a"),
      itemCoverStamp(bumped),
    );
    assert.equal(coverMapsNeedsResolve(controller.getMaps(), bumped), false);
  });

  it("noteDisplayedMaps refreshes only on path→null downgrade", async () => {
    const item = stubItem("a");
    let refreshCalls = 0;
    const controller = createCoverController(
      {
        resolveProgressive: async (items, options) => {
          refreshCalls += items.length;
          for (const row of items) {
            options.onResolved?.(row.id, "/new", { width: 2, height: 2 });
          }
        },
        getRequestVersion: () => 1,
        getQueryKey: () => "k",
        getItem: () => item,
      },
      coverMapsFromTriple(
        new Map([["a", "/old"]]),
        new Map([["a", itemCoverStamp(item)]]),
        new Map([["a", { width: 1, height: 1 }]]),
      ),
    );

    // Seed displayed baseline.
    controller.noteDisplayedMaps([item]);

    const nextNull: CoverMaps = coverMapsFromTriple(
      new Map([["a", null]]),
      new Map([["a", itemCoverStamp(item)]]),
      new Map([["a", null]]),
    );
    controller.replaceMaps(nextNull);
    controller.noteDisplayedMaps([item]);
    await Promise.resolve();
    assert.equal(refreshCalls, 1);
    assert.equal(controller.getMaps().paths.get("a"), "/new");

    refreshCalls = 0;
    const empty = emptyCoverMaps();
    const firstNull = coverMapsFromTriple(
      new Map([["a", null]]),
      new Map([["a", itemCoverStamp(item)]]),
      new Map([["a", null]]),
    );
    controller.replaceMaps(empty);
    controller.noteDisplayedMaps([item]);
    controller.replaceMaps(firstNull);
    controller.noteDisplayedMaps([item]);
    await Promise.resolve();
    assert.equal(refreshCalls, 0);
  });

  it("probeStickyNulls has no controller lifetime gate (shell owns one-shot)", async () => {
    const item = stubItem("a");
    let calls = 0;
    const controller = createCoverController(
      {
        resolveProgressive: async () => {
          calls += 1;
        },
        getRequestVersion: () => 1,
        getQueryKey: () => "k",
        getItem: () => item,
      },
      coverMapsFromTriple(
        new Map([["a", null]]),
        new Map([["a", itemCoverStamp(item)]]),
        new Map([["a", null]]),
      ),
    );

    controller.probeStickyNulls([item]);
    controller.probeStickyNulls([item]);
    await Promise.resolve();
    assert.equal(calls, 2);
  });

  it("deferPublish then publish emits once; published lags live", () => {
    let emits = 0;
    const controller = createCoverController({
      resolveProgressive: async () => {},
      getRequestVersion: () => 1,
      getQueryKey: () => "k",
      getItem: () => undefined,
    });
    controller.subscribe(() => {
      emits += 1;
    });

    controller.replaceMaps(
      coverMapsFromTriple(
        new Map([["a", "/a"]]),
        new Map([["a", "s"]]),
        new Map([["a", null]]),
      ),
      { deferPublish: true },
    );
    assert.equal(emits, 0);
    assert.equal(controller.getMaps().paths.get("a"), "/a");
    assert.equal(controller.getPublishedMaps().paths.has("a"), false);
    controller.publish();
    assert.equal(emits, 1);
    assert.equal(controller.getPublishedMaps().paths.get("a"), "/a");
  });

  it("refresh during deferPublish stays silent until publish", async () => {
    const item = stubItem("a");
    let emits = 0;
    const controller = createCoverController({
      resolveProgressive: async (items, options) => {
        for (const row of items) {
          options.onResolved?.(row.id, "/refreshed", {
            width: 3,
            height: 3,
          });
        }
      },
      getRequestVersion: () => 1,
      getQueryKey: () => "k",
      getItem: () => item,
    });
    controller.subscribe(() => {
      emits += 1;
    });

    controller.replaceMaps(
      coverMapsFromTriple(
        new Map([["a", "/held"]]),
        new Map([["a", itemCoverStamp(item)]]),
        new Map([["a", { width: 1, height: 1 }]]),
      ),
      { deferPublish: true },
    );
    assert.equal(emits, 0);

    controller.refresh("a");
    await Promise.resolve();
    assert.equal(emits, 0);
    assert.equal(controller.getMaps().paths.get("a"), "/refreshed");
    assert.equal(controller.getPublishedMaps().paths.has("a"), false);

    controller.publish();
    assert.equal(emits, 1);
    assert.equal(controller.getPublishedMaps().paths.get("a"), "/refreshed");
  });

  it("cancelDeferredPublish clears hold without emitting", () => {
    let emits = 0;
    const controller = createCoverController({
      resolveProgressive: async () => {},
      getRequestVersion: () => 1,
      getQueryKey: () => "k",
      getItem: () => undefined,
    });
    controller.subscribe(() => {
      emits += 1;
    });

    controller.replaceMaps(
      coverMapsFromTriple(
        new Map([["a", "/a"]]),
        new Map([["a", "s"]]),
        new Map([["a", null]]),
      ),
      { deferPublish: true },
    );
    controller.cancelDeferredPublish();
    assert.equal(emits, 0);
    assert.equal(controller.getPublishedMaps().paths.has("a"), false);
    assert.equal(controller.getMaps().paths.get("a"), "/a");

    // Next non-deferred write publishes live to React.
    controller.replaceMaps(
      coverMapsFromTriple(
        new Map([["a", "/b"]]),
        new Map([["a", "s2"]]),
        new Map([["a", null]]),
      ),
    );
    assert.equal(emits, 1);
    assert.equal(controller.getPublishedMaps().paths.get("a"), "/b");
  });

  it("stale cancelDeferredPublish does not kill a newer version hold", () => {
    let emits = 0;
    const controller = createCoverController({
      resolveProgressive: async () => {},
      getRequestVersion: () => 2,
      getQueryKey: () => "k",
      getItem: () => undefined,
    });
    controller.subscribe(() => {
      emits += 1;
    });

    controller.replaceMaps(
      coverMapsFromTriple(
        new Map([["a", "/v2"]]),
        new Map([["a", "s"]]),
        new Map([["a", { width: 10, height: 10 }]]),
      ),
      { deferPublish: true, requestVersion: 2 },
    );
    // Stale V1 completion must not clear V2's hold.
    controller.cancelDeferredPublish(1);
    assert.equal(emits, 0);
    assert.equal(controller.getPublishedMaps().paths.has("a"), false);

    // publish() still works for V2.
    controller.publish();
    assert.equal(emits, 1);
    assert.equal(controller.getPublishedMaps().paths.get("a"), "/v2");
  });

  it("flushPublished emits even after stale cancel cleared the hold", () => {
    let emits = 0;
    const controller = createCoverController({
      resolveProgressive: async () => {},
      getRequestVersion: () => 2,
      getQueryKey: () => "k",
      getItem: () => undefined,
    });
    controller.subscribe(() => {
      emits += 1;
    });

    controller.replaceMaps(
      coverMapsFromTriple(
        new Map([["b", "/ready"]]),
        new Map([["b", "s"]]),
        new Map([["b", { width: 4, height: 5 }]]),
      ),
      { deferPublish: true, requestVersion: 2 },
    );
    // Race: stale cancel cleared hold; publish() would no-op.
    controller.cancelDeferredPublish(2);
    assert.equal(emits, 0);
    controller.publish();
    assert.equal(emits, 0);

    controller.flushPublished();
    assert.equal(emits, 1);
    assert.equal(controller.getPublishedMaps().paths.get("b"), "/ready");
  });

  it("ensureFlightForHoles heals published lag when live is complete", () => {
    let emits = 0;
    const item = stubItem("a", { thumbnail: "t.webp" });
    const stamp = itemCoverStamp(item);
    const controller = createCoverController(
      {
        resolveProgressive: async () => {},
        getRequestVersion: () => 1,
        getQueryKey: () => "k",
        getItem: () => item,
      },
      emptyCoverMaps(),
    );
    controller.subscribe(() => {
      emits += 1;
    });

    controller.replaceMaps(
      coverMapsFromTriple(
        new Map([["a", "/cover"]]),
        new Map([["a", stamp]]),
        new Map([["a", { width: 8, height: 8 }]]),
      ),
      { deferPublish: true, requestVersion: 1 },
    );
    controller.cancelDeferredPublish(1);
    assert.equal(controller.getPublishedMaps().paths.has("a"), false);

    controller.ensureFlightForHoles([item]);
    assert.equal(emits, 1);
    assert.equal(controller.getPublishedMaps().paths.get("a"), "/cover");
  });

  it("published maps do not share Map identity with live SoT", () => {
    const controller = createCoverController({
      resolveProgressive: async () => {},
      getRequestVersion: () => 1,
      getQueryKey: () => "k",
      getItem: () => undefined,
    });
    controller.replaceMaps(
      coverMapsFromTriple(
        new Map([["a", "/a"]]),
        new Map([["a", "s"]]),
        new Map([["a", null]]),
      ),
    );
    const live = controller.getMaps();
    const published = controller.getPublishedMaps();
    assert.notEqual(live.paths, published.paths);
    published.paths.set("a", "/mutated");
    assert.equal(controller.getMaps().paths.get("a"), "/a");
  });
});
