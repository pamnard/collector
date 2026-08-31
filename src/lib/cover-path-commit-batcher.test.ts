import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCoverPathCommitBatcher } from "./cover-path-commit-batcher.ts";
import {
  coverMapsFromTriple,
  type CoverMaps,
} from "./cover-maps.ts";
import type { ItemThumbnailPixelSize } from "@collector/api";

describe("createCoverPathCommitBatcher", () => {
  it("coalesces N enqueue into one commit on flush", () => {
    let maps: CoverMaps = coverMapsFromTriple(
      new Map(),
      new Map(),
      new Map(),
    );
    let commits = 0;
    const scheduled: Array<() => void> = [];

    const batcher = createCoverPathCommitBatcher({
      requestVersion: 1,
      getRequestVersion: () => 1,
      isAborted: () => false,
      getOrderedIds: () => ["a", "b", "c"],
      getMaps: () => maps,
      commit: (next) => {
        commits += 1;
        maps = next;
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
    });

    batcher.enqueue("a", "/a", "ta", { width: 10, height: 10 });
    batcher.enqueue("b", "/b", "tb", { width: 20, height: 20 });
    batcher.enqueue("c", "/c", "tc", null);
    assert.equal(commits, 0);
    assert.equal(scheduled.length, 1);

    batcher.flush();
    assert.equal(commits, 1);
    assert.equal(scheduled.length, 0);
    assert.equal(maps.paths.get("a"), "/a");
    assert.equal(maps.paths.get("b"), "/b");
    assert.equal(maps.paths.get("c"), "/c");
    assert.equal(maps.stamps.get("a"), "ta");
    assert.deepEqual(maps.sizes.get("a"), { width: 10, height: 10 });
  });

  it("no-op scheduleFlush still commits on final flush (blockOnCovers)", () => {
    let maps: CoverMaps = coverMapsFromTriple(
      new Map(),
      new Map(),
      new Map(),
    );
    let commits = 0;

    const batcher = createCoverPathCommitBatcher({
      requestVersion: 1,
      getRequestVersion: () => 1,
      isAborted: () => false,
      getOrderedIds: () => ["a", "b"],
      getMaps: () => maps,
      commit: (next) => {
        commits += 1;
        maps = next;
      },
      // Same as CoverController blockOnCovers: never auto-flush.
      scheduleFlush: () => () => {},
    });

    batcher.enqueue("a", "/a", "ta", { width: 10, height: 10 });
    batcher.enqueue("b", "/b", "tb", { width: 20, height: 20 });
    assert.equal(commits, 0);

    batcher.flush();
    assert.equal(commits, 1);
    assert.equal(maps.paths.get("a"), "/a");
    assert.equal(maps.paths.get("b"), "/b");
  });

  it("cancel flushes pending when request is still live, then rejects further work", () => {
    let maps: CoverMaps = coverMapsFromTriple(
      new Map(),
      new Map(),
      new Map(),
    );
    let commits = 0;

    const batcher = createCoverPathCommitBatcher({
      requestVersion: 1,
      getRequestVersion: () => 1,
      isAborted: () => false,
      getOrderedIds: () => ["a"],
      getMaps: () => maps,
      commit: (next) => {
        commits += 1;
        maps = next;
      },
      scheduleFlush: () => () => {},
    });

    batcher.enqueue("a", "/a", "ta", { width: 1, height: 1 });
    batcher.cancel();
    assert.equal(commits, 1);
    assert.equal(maps.paths.get("a"), "/a");

    batcher.enqueue("a", "/a2", "ta2", { width: 2, height: 2 });
    batcher.flush();
    assert.equal(commits, 1);
    assert.equal(maps.paths.get("a"), "/a");
  });

  it("cancel drops pending when requestVersion is already stale", () => {
    let maps: CoverMaps = coverMapsFromTriple(
      new Map(),
      new Map(),
      new Map(),
    );
    let commits = 0;
    let version = 1;

    const batcher = createCoverPathCommitBatcher({
      requestVersion: 1,
      getRequestVersion: () => version,
      isAborted: () => false,
      getOrderedIds: () => ["a"],
      getMaps: () => maps,
      commit: (next) => {
        commits += 1;
        maps = next;
      },
      scheduleFlush: () => () => {},
    });

    batcher.enqueue("a", "/a", "ta", { width: 1, height: 1 });
    version = 2;
    batcher.cancel();
    assert.equal(commits, 0);
    assert.equal(maps.paths.size, 0);
  });

  it("does not enqueue null over an existing cover path (#871)", () => {
    let maps: CoverMaps = coverMapsFromTriple(
      new Map([["a", "/a"]]),
      new Map([["a", "ta"]]),
      new Map<string, ItemThumbnailPixelSize | null>([
        ["a", { width: 1, height: 1 }],
      ]),
    );
    let commits = 0;

    const batcher = createCoverPathCommitBatcher({
      requestVersion: 1,
      getRequestVersion: () => 1,
      isAborted: () => false,
      getOrderedIds: () => ["a"],
      getMaps: () => maps,
      commit: (next) => {
        commits += 1;
        maps = next;
      },
      scheduleFlush: () => () => {},
    });

    batcher.enqueue("a", null, "tb", null);
    batcher.flush();
    assert.equal(commits, 0);
    assert.equal(maps.paths.get("a"), "/a");
  });

  it("flush does not prune covers for ids outside flight window (#877)", () => {
    let maps: CoverMaps = coverMapsFromTriple(
      new Map([
        ["old-a", "/old-a"],
        ["old-b", "/old-b"],
      ]),
      new Map([
        ["old-a", "sa"],
        ["old-b", "sb"],
      ]),
      new Map<string, ItemThumbnailPixelSize | null>([
        ["old-a", { width: 10, height: 10 }],
        ["old-b", { width: 20, height: 20 }],
      ]),
    );

    const batcher = createCoverPathCommitBatcher({
      requestVersion: 1,
      getRequestVersion: () => 1,
      isAborted: () => false,
      // New folder flight window — must not strip still-painted old covers.
      getOrderedIds: () => ["new-c"],
      getMaps: () => maps,
      commit: (next) => {
        maps = next;
      },
      scheduleFlush: () => () => {},
    });

    batcher.enqueue("new-c", "/new-c", "sc", { width: 30, height: 30 });
    batcher.flush();

    assert.equal(maps.paths.get("old-a"), "/old-a");
    assert.equal(maps.paths.get("old-b"), "/old-b");
    assert.equal(maps.paths.get("new-c"), "/new-c");
    assert.equal(maps.paths.size, 3);
  });
});
