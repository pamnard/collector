import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCoverPathCommitBatcher } from "./cover-path-commit-batcher.ts";
import type { ItemThumbnailPixelSize } from "@collector/api";

describe("createCoverPathCommitBatcher", () => {
  it("coalesces N enqueue into one commit on flush", () => {
    let paths = new Map<string, string | null>();
    let stamps = new Map<string, string>();
    let sizes = new Map<string, ItemThumbnailPixelSize | null>();
    let commits = 0;
    const scheduled: Array<() => void> = [];

    const batcher = createCoverPathCommitBatcher({
      requestVersion: 1,
      getRequestVersion: () => 1,
      isAborted: () => false,
      getOrderedIds: () => ["a", "b", "c"],
      getPaths: () => paths,
      getStamps: () => stamps,
      getSizes: () => sizes,
      commit: (nextPaths, nextStamps, nextSizes) => {
        commits += 1;
        paths = nextPaths;
        stamps = nextStamps;
        sizes = nextSizes;
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
    assert.equal(paths.get("a"), "/a");
    assert.equal(paths.get("b"), "/b");
    assert.equal(paths.get("c"), "/c");
    assert.equal(stamps.get("a"), "ta");
    assert.deepEqual(sizes.get("a"), { width: 10, height: 10 });
  });

  it("cancel flushes pending when request is still live, then rejects further work", () => {
    let paths = new Map<string, string | null>();
    let stamps = new Map<string, string>();
    let sizes = new Map<string, ItemThumbnailPixelSize | null>();
    let commits = 0;

    const batcher = createCoverPathCommitBatcher({
      requestVersion: 1,
      getRequestVersion: () => 1,
      isAborted: () => false,
      getOrderedIds: () => ["a"],
      getPaths: () => paths,
      getStamps: () => stamps,
      getSizes: () => sizes,
      commit: (nextPaths, nextStamps, nextSizes) => {
        commits += 1;
        paths = nextPaths;
        stamps = nextStamps;
        sizes = nextSizes;
      },
      scheduleFlush: () => () => {},
    });

    batcher.enqueue("a", "/a", "ta", { width: 1, height: 1 });
    batcher.cancel();
    assert.equal(commits, 1);
    assert.equal(paths.get("a"), "/a");
    batcher.flush();
    batcher.enqueue("a", "/a2", "ta2", { width: 2, height: 2 });
    assert.equal(commits, 1);
  });

  it("cancel drops pending when requestVersion is already stale", () => {
    let version = 1;
    let paths = new Map<string, string | null>();
    let stamps = new Map<string, string>();
    let sizes = new Map<string, ItemThumbnailPixelSize | null>();
    let commits = 0;

    const batcher = createCoverPathCommitBatcher({
      requestVersion: 1,
      getRequestVersion: () => version,
      isAborted: () => false,
      getOrderedIds: () => ["a"],
      getPaths: () => paths,
      getStamps: () => stamps,
      getSizes: () => sizes,
      commit: (nextPaths, nextStamps, nextSizes) => {
        commits += 1;
        paths = nextPaths;
        stamps = nextStamps;
        sizes = nextSizes;
      },
      scheduleFlush: () => () => {},
    });

    batcher.enqueue("a", "/a", "ta", { width: 1, height: 1 });
    version = 2;
    batcher.cancel();
    assert.equal(commits, 0);
    assert.equal(paths.size, 0);
  });
});
