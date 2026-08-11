import type { TeaserSpan } from "./composition";

export type TeaserBoardId = "4x2" | "3x2" | "2x2";

export type BoardSize = {
  cols: number;
  rows: number;
};

export type SpanSize = {
  w: number;
  h: number;
};

export const BOARD_SHRINK_ORDER: readonly TeaserBoardId[] = [
  "4x2",
  "3x2",
  "2x2",
];

const BOARD_SIZES: Record<TeaserBoardId, BoardSize> = {
  "4x2": { cols: 4, rows: 2 },
  "3x2": { cols: 3, rows: 2 },
  "2x2": { cols: 2, rows: 2 },
};

const SPAN_SIZES: Record<TeaserSpan, SpanSize> = {
  "1x1": { w: 1, h: 1 },
  "1x2": { w: 1, h: 2 },
  "2x1": { w: 2, h: 1 },
  "2x2": { w: 2, h: 2 },
};

export function boardSize(board: TeaserBoardId): BoardSize {
  return BOARD_SIZES[board];
}

export function spanSize(span: TeaserSpan): SpanSize {
  return SPAN_SIZES[span];
}

export function isSpanAllowedOnBoard(
  board: TeaserBoardId,
  span: TeaserSpan,
): boolean {
  if (board === "2x2" && span === "2x2") {
    return false;
  }
  return true;
}

/** Whether a span fits at (col, row) without leaving the board. */
export function spanFits(
  board: TeaserBoardId,
  span: TeaserSpan,
  col: number,
  row: number,
): boolean {
  const { cols, rows } = boardSize(board);
  const { w, h } = spanSize(span);
  if (col < 0 || row < 0) {
    return false;
  }
  return col + w <= cols && row + h <= rows;
}
