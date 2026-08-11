import { describe, expect, it } from "vitest";
import {
  BOARD_SHRINK_ORDER,
  boardSize,
  isSpanAllowedOnBoard,
  spanSize,
  type TeaserBoardId,
} from "./board";
import type { TeaserSpan } from "./composition";

describe("boardSize / BOARD_SHRINK_ORDER", () => {
  it("exposes board dimensions", () => {
    expect(boardSize("4x2")).toEqual({ cols: 4, rows: 2 });
    expect(boardSize("3x2")).toEqual({ cols: 3, rows: 2 });
    expect(boardSize("2x2")).toEqual({ cols: 2, rows: 2 });
  });

  it("shrinks 4x2 → 3x2 → 2x2", () => {
    expect(BOARD_SHRINK_ORDER).toEqual(["4x2", "3x2", "2x2"]);
  });
});

describe("spanSize", () => {
  it("maps teaser spans to width/height", () => {
    expect(spanSize("1x1")).toEqual({ w: 1, h: 1 });
    expect(spanSize("1x2")).toEqual({ w: 1, h: 2 });
    expect(spanSize("2x1")).toEqual({ w: 2, h: 1 });
    expect(spanSize("2x2")).toEqual({ w: 2, h: 2 });
  });
});

describe("isSpanAllowedOnBoard", () => {
  const allSpans: TeaserSpan[] = ["1x1", "1x2", "2x1", "2x2"];
  const wideBoards: TeaserBoardId[] = ["4x2", "3x2"];

  it("allows every span on 4x2 and 3x2", () => {
    for (const board of wideBoards) {
      for (const span of allSpans) {
        expect(isSpanAllowedOnBoard(board, span)).toBe(true);
      }
    }
  });

  it("forbids span 2x2 on board 2x2 and allows the rest", () => {
    expect(isSpanAllowedOnBoard("2x2", "2x2")).toBe(false);
    expect(isSpanAllowedOnBoard("2x2", "1x1")).toBe(true);
    expect(isSpanAllowedOnBoard("2x2", "1x2")).toBe(true);
    expect(isSpanAllowedOnBoard("2x2", "2x1")).toBe(true);
  });
});
