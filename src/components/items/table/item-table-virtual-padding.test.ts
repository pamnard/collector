import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { itemTableVirtualPadding } from "./item-table-virtual-padding.ts";

describe("itemTableVirtualPadding", () => {
  it("returns zeros when there are no virtual rows", () => {
    assert.deepEqual(itemTableVirtualPadding([], 400, 80), {
      paddingTop: 0,
      paddingBottom: 0,
    });
  });

  it("computes top and bottom padding from virtual window", () => {
    assert.deepEqual(
      itemTableVirtualPadding(
        [
          { start: 120, end: 160 },
          { start: 160, end: 200 },
        ],
        1000,
        80,
      ),
      {
        paddingTop: 40,
        paddingBottom: 800,
      },
    );
  });

  it("clamps negative top padding to zero", () => {
    assert.deepEqual(
      itemTableVirtualPadding([{ start: 40, end: 80 }], 200, 80),
      {
        paddingTop: 0,
        paddingBottom: 120,
      },
    );
  });
});
