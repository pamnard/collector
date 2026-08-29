/**
 * Related board chrome must stay in sync with ItemRelatedPanel:
 * `px-4 md:px-8` and `gap-4 md:gap-8` (Tailwind default md = 768).
 */
export const RELATED_BOARD_MD_MIN_PX = 768;

/** 1×1 slot aspect: width / height (landscape 4:3). */
export const RELATED_SLOT_ASPECT_W = 4;
export const RELATED_SLOT_ASPECT_H = 3;

/** Total horizontal padding (left + right) around the board grid. */
export function relatedBoardPadXPx(containerWidthPx: number): number {
  if (containerWidthPx < 0) {
    throw new Error("container width must be non-negative");
  }
  return containerWidthPx >= RELATED_BOARD_MD_MIN_PX ? 64 : 32;
}

/** Grid gap between teaser cells. */
export function relatedBoardGapPx(containerWidthPx: number): number {
  if (containerWidthPx < 0) {
    throw new Error("container width must be non-negative");
  }
  return containerWidthPx >= RELATED_BOARD_MD_MIN_PX ? 32 : 16;
}

function relatedBoardCellWidthPx(options: {
  gridWidthPx: number;
  cols: number;
  gapPx: number;
}): number {
  const { gridWidthPx, cols, gapPx } = options;
  if (!(gridWidthPx > 0) || !(cols > 0)) {
    throw new Error("board width and cols must be positive");
  }
  if (gapPx < 0) {
    throw new Error("gap must be non-negative");
  }
  const cellWidthPx = (gridWidthPx - gapPx * (cols - 1)) / cols;
  if (!(cellWidthPx > 0)) {
    throw new Error("board gap leaves no positive cell size");
  }
  return cellWidthPx;
}

/**
 * Board height so each 1×1 track is 4:3 (wider than tall).
 * Span 1×2 stacks two row tracks → taller than wide; 1×1 stays landscape.
 */
export function boardGridHeightPx(options: {
  widthPx: number;
  cols: number;
  rows: number;
  gapPx: number;
}): number {
  const { widthPx, cols, rows, gapPx } = options;
  if (!(rows > 0)) {
    throw new Error("board rows must be positive");
  }
  const cellWidthPx = relatedBoardCellWidthPx({
    gridWidthPx: widthPx,
    cols,
    gapPx,
  });
  const cellHeightPx =
    (cellWidthPx * RELATED_SLOT_ASPECT_H) / RELATED_SLOT_ASPECT_W;
  return rows * cellHeightPx + gapPx * (rows - 1);
}

/**
 * CSS width of one related board slot (including gaps inside multi-col spans).
 * Used for `/media/derive` — must match the painted cell, not a catalog guess.
 */
export function relatedSlotCssWidthPx(options: {
  gridWidthPx: number;
  cols: number;
  gapPx: number;
  colSpan: number;
}): number {
  const { gridWidthPx, cols, gapPx, colSpan } = options;
  if (!(colSpan > 0)) {
    throw new Error("related colSpan must be positive");
  }
  if (colSpan > cols) {
    throw new Error(
      `related colSpan ${colSpan} cannot exceed board cols ${cols}`,
    );
  }
  const cellWidthPx = relatedBoardCellWidthPx({ gridWidthPx, cols, gapPx });
  return cellWidthPx * colSpan + gapPx * (colSpan - 1);
}
