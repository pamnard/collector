import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computePreservedStreamEnd,
  nextStreamWindow,
  planApplyOffsetZeroPage,
  planLoadMore,
} from "./dashboard-query-window.ts";

describe("computePreservedStreamEnd", () => {
  it("clamps previous end when already streaming", () => {
    assert.equal(computePreservedStreamEnd(40, 10, 24), 10);
    assert.equal(computePreservedStreamEnd(5, 100, 24), 5);
  });

  it("uses prefetch size when previous end is zero", () => {
    assert.equal(computePreservedStreamEnd(0, 100, 24), 24);
    assert.equal(computePreservedStreamEnd(0, 10, 24), 10);
  });
});

describe("planApplyOffsetZeroPage", () => {
  it("returns empty for no ids", () => {
    assert.deepEqual(
      planApplyOffsetZeroPage({
        pageItemIds: [],
        pageStamps: [],
        previousIds: ["a"],
        previousStreamEnd: 1,
        prefetchSize: 24,
        itemsByIdHas: () => true,
        cachedStampFor: () => undefined,
      }),
      {
        kind: "empty",
        preservedEnd: 0,
        needsStream: false,
        idsToKeepBodies: [],
      },
    );
  });

  it("plans ids-changed with full keep list and needsStream", () => {
    const plan = planApplyOffsetZeroPage({
      pageItemIds: ["a", "b", "c"],
      pageStamps: ["1", "2", "3"],
      previousIds: ["x"],
      previousStreamEnd: 0,
      prefetchSize: 24,
      itemsByIdHas: () => false,
      cachedStampFor: () => undefined,
    });
    assert.equal(plan.kind, "ids-changed");
    assert.equal(plan.preservedEnd, 3);
    assert.equal(plan.needsStream, true);
    assert.deepEqual(plan.idsToKeepBodies, ["a", "b", "c"]);
  });

  it("plans ids-same and detects missing bodies in window", () => {
    const has = new Set(["a"]);
    const plan = planApplyOffsetZeroPage({
      pageItemIds: ["a", "b"],
      pageStamps: ["100", "200"],
      previousIds: ["a", "b"],
      previousStreamEnd: 2,
      prefetchSize: 24,
      itemsByIdHas: (id) => has.has(id),
      cachedStampFor: (id) => (id === "a" ? "100" : "200"),
    });
    assert.deepEqual(plan, {
      kind: "ids-same",
      preservedEnd: 2,
      needsStream: true,
      idsToKeepBodies: ["a", "b"],
    });
  });

  it("plans ids-same without stream when window bodies and stamps match", () => {
    const stamps = new Map([
      ["a", "100"],
      ["b", "200"],
    ]);
    const plan = planApplyOffsetZeroPage({
      pageItemIds: ["a", "b"],
      pageStamps: ["100", "200"],
      previousIds: ["a", "b"],
      previousStreamEnd: 2,
      prefetchSize: 24,
      itemsByIdHas: () => true,
      cachedStampFor: (id) => stamps.get(id),
    });
    assert.equal(plan.kind, "ids-same");
    assert.equal(plan.needsStream, false);
  });

  it("plans ids-same with stream when body exists but stamp is newer", () => {
    const plan = planApplyOffsetZeroPage({
      pageItemIds: ["a", "b"],
      pageStamps: ["100", "999"],
      previousIds: ["a", "b"],
      previousStreamEnd: 2,
      prefetchSize: 24,
      itemsByIdHas: () => true,
      cachedStampFor: (id) => (id === "a" ? "100" : "200"),
    });
    assert.equal(plan.kind, "ids-same");
    assert.equal(plan.needsStream, true);
  });

  it("plans ids-same with stream when cached stamp is missing", () => {
    const plan = planApplyOffsetZeroPage({
      pageItemIds: ["a"],
      pageStamps: ["100"],
      previousIds: ["a"],
      previousStreamEnd: 1,
      prefetchSize: 24,
      itemsByIdHas: () => true,
      cachedStampFor: () => undefined,
    });
    assert.equal(plan.kind, "ids-same");
    assert.equal(plan.needsStream, true);
  });
});

describe("planLoadMore", () => {
  it("noops while loading", () => {
    assert.equal(
      planLoadMore({
        isLoading: true,
        isLoadingMore: false,
        streamEndOffset: 0,
        loadedCount: 24,
        totalCount: 100,
        prefetchSize: 24,
      }).kind,
      "noop",
    );
    assert.equal(
      planLoadMore({
        isLoading: false,
        isLoadingMore: true,
        streamEndOffset: 0,
        loadedCount: 24,
        totalCount: 100,
        prefetchSize: 24,
      }).kind,
      "noop",
    );
  });

  it("noops when stream caught up and no unloaded ids", () => {
    assert.equal(
      planLoadMore({
        isLoading: false,
        isLoadingMore: false,
        streamEndOffset: 50,
        loadedCount: 50,
        totalCount: 50,
        prefetchSize: 24,
      }).kind,
      "noop",
    );
  });

  it("fetches more ids when window would overrun loaded ids", () => {
    assert.equal(
      planLoadMore({
        isLoading: false,
        isLoadingMore: false,
        streamEndOffset: 20,
        loadedCount: 24,
        totalCount: 100,
        prefetchSize: 24,
      }).kind,
      "fetch-ids-then-stream",
    );
  });

  it("streams only when enough ids are already loaded", () => {
    assert.equal(
      planLoadMore({
        isLoading: false,
        isLoadingMore: false,
        streamEndOffset: 0,
        loadedCount: 48,
        totalCount: 100,
        prefetchSize: 24,
      }).kind,
      "stream-only",
    );
  });
});

describe("nextStreamWindow", () => {
  it("advances by prefetch size within id count", () => {
    assert.deepEqual(nextStreamWindow(0, 100, 24), {
      offset: 0,
      limit: 24,
      nextEnd: 24,
    });
    assert.deepEqual(nextStreamWindow(90, 100, 24), {
      offset: 90,
      limit: 10,
      nextEnd: 100,
    });
  });
});
