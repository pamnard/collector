import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ItemFile } from "@collector/shared";
import { itemCoverStamp } from "./dashboard-commit.ts";
import {
  coverMapsFromTriple,
  emptyCoverMaps,
  type CoverMaps,
} from "./cover-maps.ts";
import {
  runCoverPathFlight,
  type CoverFlightSlot,
} from "./dashboard-cover-flight.ts";

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
    thumbnail: "c.webp",
    ...overrides,
  } as ItemFile;
}

describe("runCoverPathFlight", () => {
  it("returns immediately when nothing needs resolve", async () => {
    const item = stubItem("a");
    const stamp = itemCoverStamp(item);
    let maps: CoverMaps = coverMapsFromTriple(
      new Map([["a", "/a"]]),
      new Map([["a", stamp]]),
      new Map([["a", { width: 10, height: 10 }]]),
    );
    let resolveCalls = 0;
    let flight: CoverFlightSlot = null;

    await runCoverPathFlight({
      requestVersion: 1,
      getRequestVersion: () => 1,
      orderedItems: [item],
      getOrderedIds: () => ["a"],
      getMaps: () => maps,
      commit: (next) => {
        maps = next;
      },
      getFlight: () => flight,
      setFlight: (next) => {
        flight = next;
      },
      resolveProgressive: async () => {
        resolveCalls += 1;
      },
    });

    assert.equal(resolveCalls, 0);
    assert.equal(flight, null);
  });

  it("re-opens sticky null holes so disk cover can win (#871)", async () => {
    const item = stubItem("a", { thumbnail: null });
    const stamp = itemCoverStamp(item);
    let maps: CoverMaps = coverMapsFromTriple(
      new Map([["a", null]]),
      new Map([["a", stamp]]),
      new Map([["a", null]]),
    );
    let flight: CoverFlightSlot = null;

    await runCoverPathFlight({
      requestVersion: 1,
      getRequestVersion: () => 1,
      orderedItems: [item],
      getOrderedIds: () => ["a"],
      getMaps: () => maps,
      commit: (next) => {
        maps = next;
      },
      getFlight: () => flight,
      setFlight: (next) => {
        flight = next;
      },
      scheduleFlush: (flush) => {
        queueMicrotask(flush);
        return () => {};
      },
      resolveProgressive: async (items, options) => {
        assert.equal(items.length, 1);
        options.onResolved?.("a", "/media/a/cover.webp", {
          width: 20,
          height: 10,
        });
      },
    });

    assert.equal(maps.paths.get("a"), "/media/a/cover.webp");
  });

  it("resolves covers and commits via batcher", async () => {
    const item = stubItem("a");
    let maps: CoverMaps = emptyCoverMaps();
    let flight: CoverFlightSlot = null;
    const scheduled: Array<() => void> = [];

    await runCoverPathFlight({
      requestVersion: 1,
      getRequestVersion: () => 1,
      orderedItems: [item],
      getOrderedIds: () => ["a"],
      getMaps: () => maps,
      commit: (next) => {
        maps = next;
      },
      getFlight: () => flight,
      setFlight: (next) => {
        flight = next;
      },
      scheduleFlush: (flush) => {
        scheduled.push(flush);
        return () => {
          const idx = scheduled.indexOf(flush);
          if (idx >= 0) {
            scheduled.splice(idx, 1);
          }
        };
      },
      resolveProgressive: async (items, options) => {
        assert.equal(items.length, 1);
        options.onResolved?.("a", "/cover-a", { width: 100, height: 80 });
      },
    });

    assert.equal(maps.paths.get("a"), "/cover-a");
    assert.equal(maps.stamps.get("a"), itemCoverStamp(item));
    assert.equal(flight, null);
  });

  it("same-version waiters share one in-flight promise", async () => {
    const item = stubItem("a");
    let maps: CoverMaps = emptyCoverMaps();
    let flight: CoverFlightSlot = null;
    let resolveCalls = 0;
    let releaseResolve: (() => void) | null = null;

    const scheduleFlush = (flush: () => void) => {
      queueMicrotask(flush);
      return () => {};
    };

    const first = runCoverPathFlight({
      requestVersion: 1,
      getRequestVersion: () => 1,
      orderedItems: [item],
      getOrderedIds: () => ["a"],
      getMaps: () => maps,
      commit: (next) => {
        maps = next;
      },
      getFlight: () => flight,
      setFlight: (next) => {
        flight = next;
      },
      scheduleFlush,
      resolveProgressive: async (_items, options) => {
        resolveCalls += 1;
        await new Promise<void>((resolve) => {
          releaseResolve = resolve;
        });
        options.onResolved?.("a", "/shared", { width: 10, height: 10 });
      },
    });

    // Let first flight register itself.
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(flight);

    const second = runCoverPathFlight({
      requestVersion: 1,
      getRequestVersion: () => 1,
      orderedItems: [item],
      getOrderedIds: () => ["a"],
      getMaps: () => maps,
      commit: (next) => {
        maps = next;
      },
      getFlight: () => flight,
      setFlight: (next) => {
        flight = next;
      },
      scheduleFlush,
      resolveProgressive: async () => {
        resolveCalls += 1;
      },
    });

    releaseResolve!();
    await Promise.all([first, second]);

    assert.equal(resolveCalls, 1);
    assert.equal(maps.paths.get("a"), "/shared");
  });

  it("stops when requestVersion becomes stale", async () => {
    const item = stubItem("a");
    let version = 1;
    let maps: CoverMaps = emptyCoverMaps();
    let flight: CoverFlightSlot = null;
    let resolveCalls = 0;

    await runCoverPathFlight({
      requestVersion: 1,
      getRequestVersion: () => version,
      orderedItems: [item],
      getOrderedIds: () => ["a"],
      getMaps: () => maps,
      commit: (next) => {
        maps = next;
      },
      getFlight: () => flight,
      setFlight: (next) => {
        flight = next;
      },
      resolveProgressive: async () => {
        resolveCalls += 1;
        version = 2;
      },
    });

    assert.ok(resolveCalls <= 1);
    assert.equal(flight, null);
  });
});
