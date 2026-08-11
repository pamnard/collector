import type { TeaserBoardId } from "./board";

/** Min container width (px) for board 4×2. */
export const BOARD_WIDTH_4X2_MIN = 900;

/** Min container width (px) for board 3×2. */
export const BOARD_WIDTH_3X2_MIN = 620;

/**
 * Map measured container width to the related teaser board (#612).
 * Shrink family: 4×2 → 3×2 → 2×2 without refetching candidates.
 */
export function boardIdForContainerWidth(widthPx: number): TeaserBoardId {
  if (widthPx < 0) {
    throw new Error("container width must be non-negative");
  }
  if (widthPx >= BOARD_WIDTH_4X2_MIN) {
    return "4x2";
  }
  if (widthPx >= BOARD_WIDTH_3X2_MIN) {
    return "3x2";
  }
  return "2x2";
}
