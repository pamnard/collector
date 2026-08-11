import { describe, expect, it } from "vitest";
import {
  boardGridHeightPx,
  relatedBoardGapPx,
  relatedBoardPadXPx,
  RELATED_BOARD_MD_MIN_PX,
} from "./board-grid-geometry";

describe("relatedBoardPadXPx / relatedBoardGapPx", () => {
  it("matches px-4/gap-4 below md and px-8/gap-8 at md+", () => {
    expect(RELATED_BOARD_MD_MIN_PX).toBe(768);
    expect(relatedBoardPadXPx(767)).toBe(32);
    expect(relatedBoardGapPx(767)).toBe(16);
    expect(relatedBoardPadXPx(768)).toBe(64);
    expect(relatedBoardGapPx(768)).toBe(32);
  });
});

describe("boardGridHeightPx", () => {
  it("makes 1x1 tracks 4:3 after gaps", () => {
    // width 800, gap 16, cols 4 → cellW (800 - 48) / 4 = 188
    // cellH = 188 * 3/4 = 141; rows 2 → height 141*2 + 16 = 298
    expect(
      boardGridHeightPx({ widthPx: 800, cols: 4, rows: 2, gapPx: 16 }),
    ).toBe(298);
  });

  it("rejects non-positive geometry", () => {
    expect(() =>
      boardGridHeightPx({ widthPx: 0, cols: 4, rows: 2, gapPx: 16 }),
    ).toThrow(/positive/i);
    expect(() =>
      boardGridHeightPx({ widthPx: 100, cols: 4, rows: 2, gapPx: 40 }),
    ).toThrow(/cell/i);
  });
});
