import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { relatedSlotCssWidthPx } from "./board-grid-geometry.ts";

describe("relatedSlotCssWidthPx", () => {
  it("matches 1-col and 2-col spans after gaps", () => {
    // width 800, gap 16, cols 4 → cellW (800 - 48) / 4 = 188
    assert.equal(
      relatedSlotCssWidthPx({
        gridWidthPx: 800,
        cols: 4,
        gapPx: 16,
        colSpan: 1,
      }),
      188,
    );
    assert.equal(
      relatedSlotCssWidthPx({
        gridWidthPx: 800,
        cols: 4,
        gapPx: 16,
        colSpan: 2,
      }),
      188 * 2 + 16,
    );
  });
});
