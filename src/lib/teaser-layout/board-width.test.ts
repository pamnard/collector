import { describe, expect, it } from "vitest";
import {
  BOARD_WIDTH_3X2_MIN,
  BOARD_WIDTH_4X2_MIN,
  boardIdForContainerWidth,
} from "./board-width";

describe("boardIdForContainerWidth", () => {
  it("uses 2x2 below the 3x2 threshold", () => {
    expect(boardIdForContainerWidth(0)).toBe("2x2");
    expect(boardIdForContainerWidth(BOARD_WIDTH_3X2_MIN - 1)).toBe("2x2");
  });

  it("uses 3x2 from 620 inclusive up to below 900", () => {
    expect(boardIdForContainerWidth(BOARD_WIDTH_3X2_MIN)).toBe("3x2");
    expect(boardIdForContainerWidth(BOARD_WIDTH_4X2_MIN - 1)).toBe("3x2");
  });

  it("uses 4x2 from 900 inclusive", () => {
    expect(boardIdForContainerWidth(BOARD_WIDTH_4X2_MIN)).toBe("4x2");
    expect(boardIdForContainerWidth(1200)).toBe("4x2");
  });

  it("rejects negative width", () => {
    expect(() => boardIdForContainerWidth(-1)).toThrow(
      /container width must be non-negative/,
    );
  });
});
