import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ItemFile } from "@collector/shared";
import {
  collectHydratedItems,
  createThrottledPublisher,
  isDashboardPrefetchWindowReady,
  itemIdsEqual,
  mapIndexQueryResult,
  mergeStreamedItemsById,
  orderDashboardItems,
  shouldApplyDashboardStreamBatch,
} from "./dashboard-display.ts";

function stubItem(id: string, title = id): ItemFile {
  return { id, title } as ItemFile;
}

describe("mapIndexQueryResult", () => {
  it("maps IndexQueryResult fields to DashboardIndexPage", () => {
    assert.deepEqual(
      mapIndexQueryResult({
        ids: ["a", "b"],
        stamps: ["1", "2"],
        total: 10,
        offset: 0,
      }),
      {
        itemIds: ["a", "b"],
        stamps: ["1", "2"],
        totalCount: 10,
        offset: 0,
      },
    );
  });
});

describe("collectHydratedItems", () => {
  it("forwards each yielded item", async () => {
    async function* gen() {
      yield stubItem("a");
      yield stubItem("b");
    }
    const seen: string[] = [];
    await collectHydratedItems(gen(), (item) => {
      seen.push(item.id);
    });
    assert.deepEqual(seen, ["a", "b"]);
  });
});

describe("createThrottledPublisher", () => {
  it("runs immediately on first schedule then coalesces", async () => {
    let n = 0;
    const pub = createThrottledPublisher(() => {
      n += 1;
    }, 50);
    pub.schedule();
    pub.schedule();
    assert.equal(n, 1);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(n, 2);
    pub.cancel();
  });

  it("flush runs pending work immediately", () => {
    let n = 0;
    const pub = createThrottledPublisher(() => {
      n += 1;
    }, 10_000);
    pub.schedule();
    assert.equal(n, 1);
    pub.schedule();
    pub.flush();
    assert.equal(n, 2);
    pub.cancel();
  });
});

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
