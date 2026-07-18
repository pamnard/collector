import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ItemFile } from "@collector/shared";
import {
  isDashboardPrefetchWindowReady,
  itemIdsEqual,
  orderDashboardItems,
} from "./dashboard-display.ts";

function stubItem(id: string): ItemFile {
  return { id } as ItemFile;
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
