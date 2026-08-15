import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextItemPruneSignal } from "./useItemPruneEffect.ts";

describe("nextItemPruneSignal", () => {
  it("bumps seq from null and from previous", () => {
    assert.deepEqual(nextItemPruneSignal(null, "a.md"), {
      itemId: "a.md",
      seq: 1,
    });
    assert.deepEqual(
      nextItemPruneSignal({ itemId: "a.md", seq: 3 }, "b.md"),
      { itemId: "b.md", seq: 4 },
    );
  });
});
