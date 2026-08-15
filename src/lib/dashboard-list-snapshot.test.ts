import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ItemFile } from "@collector/shared";
import { pruneItemIdFromDashboardListSnapshot } from "./dashboard-list-snapshot.ts";

function stubItem(id: string): ItemFile {
  return { id } as ItemFile;
}

describe("pruneItemIdFromDashboardListSnapshot", () => {
  it("is idempotent when id is absent from ids and bodies", () => {
    const input = {
      itemIds: ["a"],
      itemsById: new Map([["a", stubItem("a")]]),
      bodyStamps: new Map([["a", "1"]]),
      thumbnailPaths: new Map<string, string | null>([["a", "/a"]]),
      thumbnailStamps: new Map([["a", "sa"]]),
      streamEndOffset: 1,
      totalCount: 1,
    };
    assert.equal(
      pruneItemIdFromDashboardListSnapshot("gone", input).removed,
      false,
    );
  });

  it("removes id from shared fields and adjusts offset/total", () => {
    const input = {
      itemIds: ["a", "b", "c"],
      itemsById: new Map([
        ["a", stubItem("a")],
        ["b", stubItem("b")],
        ["c", stubItem("c")],
      ]),
      bodyStamps: new Map([
        ["a", "1"],
        ["b", "2"],
        ["c", "3"],
      ]),
      thumbnailPaths: new Map<string, string | null>([
        ["a", "/a"],
        ["b", "/b"],
        ["c", null],
      ]),
      thumbnailStamps: new Map([
        ["a", "sa"],
        ["b", "sb"],
        ["c", "sc"],
      ]),
      streamEndOffset: 3,
      totalCount: 10,
    };
    const result = pruneItemIdFromDashboardListSnapshot("b", input);
    assert.equal(result.removed, true);
    if (!result.removed) {
      return;
    }
    assert.deepEqual(result.itemIds, ["a", "c"]);
    assert.equal(result.itemsById.has("b"), false);
    assert.equal(result.bodyStamps.has("b"), false);
    assert.equal(result.thumbnailPaths.has("b"), false);
    assert.equal(result.thumbnailStamps.has("b"), false);
    assert.equal(result.streamEndOffset, 2);
    assert.equal(result.totalCount, 9);
  });
});
