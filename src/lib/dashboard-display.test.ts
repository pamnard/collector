import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ItemFile } from "@collector/shared";
import {
  isDashboardPrefetchWindowReady,
  itemIdsEqual,
  mergeStreamedItemsById,
  orderDashboardItems,
  shouldApplyDashboardStreamBatch,
} from "./dashboard-display.ts";

function stubItem(id: string, title = id): ItemFile {
  return { id, title } as ItemFile;
}

describe("orderDashboardItems", () => {
  it("keeps stream order and skips missing bodies", () => {
    const ids = ["a", "b", "c"];
    const byId = new Map([
      ["a", stubItem("a")],
      ["c", stubItem("c")],
    ]);
    assert.deepEqual(
      orderDashboardItems(ids, byId, 3).map((item) => item.id),
      ["a", "c"],
    );
  });
});

describe("isDashboardPrefetchWindowReady", () => {
  it("treats empty id list with zero window as ready", () => {
    assert.equal(isDashboardPrefetchWindowReady([], new Map(), 0), true);
  });

  it("rejects partial window bodies", () => {
    const ids = ["a", "b"];
    const byId = new Map([["a", stubItem("a")]]);
    assert.equal(isDashboardPrefetchWindowReady(ids, byId, 2), false);
  });

  it("accepts full window bodies", () => {
    const ids = ["a", "b"];
    const byId = new Map([
      ["a", stubItem("a")],
      ["b", stubItem("b")],
    ]);
    assert.equal(isDashboardPrefetchWindowReady(ids, byId, 2), true);
  });
});

describe("itemIdsEqual", () => {
  it("compares length and order", () => {
    assert.equal(itemIdsEqual(["a", "b"], ["a", "b"]), true);
    assert.equal(itemIdsEqual(["a", "b"], ["b", "a"]), false);
  });
});

describe("mergeStreamedItemsById", () => {
  it("merges a chunk in one clone without mutating current", () => {
    const current = new Map([
      ["a", stubItem("a", "old-a")],
      ["b", stubItem("b")],
    ]);
    const pending = new Map([
      ["a", stubItem("a", "new-a")],
      ["c", stubItem("c")],
    ]);
    const next = mergeStreamedItemsById(current, pending);
    assert.equal(current.get("a")?.title, "old-a");
    assert.equal(next.get("a")?.title, "new-a");
    assert.equal(next.get("b")?.id, "b");
    assert.equal(next.get("c")?.id, "c");
    assert.equal(next.size, 3);
  });
});

describe("shouldApplyDashboardStreamBatch", () => {
  it("applies only matching request versions with pending items", () => {
    assert.equal(shouldApplyDashboardStreamBatch(3, 3, 2), true);
    assert.equal(shouldApplyDashboardStreamBatch(4, 3, 2), false);
    assert.equal(shouldApplyDashboardStreamBatch(3, 3, 0), false);
  });
});
