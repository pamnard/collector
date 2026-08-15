import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCoverPathCommitBatcher } from "./cover-path-commit-batcher.ts";

describe("createCoverPathCommitBatcher", () => {
  it("coalesces N enqueue into one commit on flush", () => {
    let paths = new Map<string, string | null>();
    let stamps = new Map<string, string>();
    let commits = 0;
    const scheduled: Array<() => void> = [];

    const batcher = createCoverPathCommitBatcher({
      requestVersion: 1,
      getRequestVersion: () => 1,
      isAborted: () => false,
      getOrderedIds: () => ["a", "b", "c"],
      getPaths: () => paths,
      getStamps: () => stamps,
      commit: (nextPaths, nextStamps) => {
        commits += 1;
        paths = nextPaths;
        stamps = nextStamps;
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

    batcher.enqueue("a", "/a", "ta");
    batcher.enqueue("b", "/b", "tb");
    batcher.enqueue("c", "/c", "tc");
    assert.equal(commits, 0);
    assert.equal(scheduled.length, 1);

    batcher.flush();
    assert.equal(commits, 1);
    assert.equal(scheduled.length, 0);
    assert.equal(paths.get("a"), "/a");
    assert.equal(paths.get("b"), "/b");
    assert.equal(paths.get("c"), "/c");
    assert.equal(stamps.get("a"), "ta");
  });

  it("scheduled flush alone commits once for a batch", () => {
    let paths = new Map<string, string | null>();
    let stamps = new Map<string, string>();
    let commits = 0;
    let runScheduled: (() => void) | null = null;

    const batcher = createCoverPathCommitBatcher({
      requestVersion: 1,
      getRequestVersion: () => 1,
      isAborted: () => false,
      getOrderedIds: () => ["a", "b"],
      getPaths: () => paths,
      getStamps: () => stamps,
      commit: (nextPaths, nextStamps) => {
        commits += 1;
        paths = nextPaths;
        stamps = nextStamps;
      },
      scheduleFlush: (flush) => {
        runScheduled = flush;
        return () => {
          runScheduled = null;
        };
      },
    });

    batcher.enqueue("a", "/a", "ta");
    batcher.enqueue("b", "/b", "tb");
    assert.equal(commits, 0);
    runScheduled!();
    assert.equal(commits, 1);
    assert.deepEqual([...paths.keys()].sort(), ["a", "b"]);
  });

  it("cancel drops pending and makes flush a no-op", () => {
    let paths = new Map<string, string | null>();
    let stamps = new Map<string, string>();
    let commits = 0;

    const batcher = createCoverPathCommitBatcher({
      requestVersion: 1,
      getRequestVersion: () => 1,
      isAborted: () => false,
      getOrderedIds: () => ["a"],
      getPaths: () => paths,
      getStamps: () => stamps,
      commit: (nextPaths, nextStamps) => {
        commits += 1;
        paths = nextPaths;
        stamps = nextStamps;
      },
      scheduleFlush: () => () => {},
    });

    batcher.enqueue("a", "/a", "ta");
    batcher.cancel();
    batcher.flush();
    batcher.enqueue("a", "/a2", "ta2");
    assert.equal(commits, 0);
    assert.equal(paths.size, 0);
  });

  it("stale requestVersion does not commit", () => {
    let version = 1;
    let paths = new Map<string, string | null>();
    let stamps = new Map<string, string>();
    let commits = 0;

    const batcher = createCoverPathCommitBatcher({
      requestVersion: 1,
      getRequestVersion: () => version,
      isAborted: () => false,
      getOrderedIds: () => ["a"],
      getPaths: () => paths,
      getStamps: () => stamps,
      commit: (nextPaths, nextStamps) => {
        commits += 1;
        paths = nextPaths;
        stamps = nextStamps;
      },
      scheduleFlush: () => () => {},
    });

    batcher.enqueue("a", "/a", "ta");
    version = 2;
    batcher.flush();
    assert.equal(commits, 0);
  });

  it("aborted signal does not commit", () => {
    let aborted = false;
    let paths = new Map<string, string | null>();
    let stamps = new Map<string, string>();
    let commits = 0;

    const batcher = createCoverPathCommitBatcher({
      requestVersion: 1,
      getRequestVersion: () => 1,
      isAborted: () => aborted,
      getOrderedIds: () => ["a"],
      getPaths: () => paths,
      getStamps: () => stamps,
      commit: (nextPaths, nextStamps) => {
        commits += 1;
        paths = nextPaths;
        stamps = nextStamps;
      },
      scheduleFlush: () => () => {},
    });

    batcher.enqueue("a", "/a", "ta");
    aborted = true;
    batcher.flush();
    assert.equal(commits, 0);
  });
});
