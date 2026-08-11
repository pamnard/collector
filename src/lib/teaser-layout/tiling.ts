import {
  boardSize,
  isSpanAllowedOnBoard,
  spanFits,
  spanSize,
  type TeaserBoardId,
} from "./board";
import {
  listAllowedCompositions,
  type TeaserComposition,
  type TeaserSpan,
} from "./composition";

export type TilePlacement = {
  span: TeaserSpan;
  col: number;
  row: number;
};

export type BoardTiling = {
  board: TeaserBoardId;
  placements: TilePlacement[];
};

const ALL_SPANS: readonly TeaserSpan[] = ["1x1", "1x2", "2x1", "2x2"];

const tilingCache = new Map<TeaserBoardId, BoardTiling[]>();

function cellIndex(cols: number, col: number, row: number): number {
  return row * cols + col;
}

function firstEmptyCell(
  occupied: boolean[],
  cols: number,
  rows: number,
): { col: number; row: number } | null {
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!occupied[cellIndex(cols, col, row)]) {
        return { col, row };
      }
    }
  }
  return null;
}

function canPlace(
  board: TeaserBoardId,
  occupied: boolean[],
  span: TeaserSpan,
  col: number,
  row: number,
): boolean {
  if (!isSpanAllowedOnBoard(board, span)) {
    return false;
  }
  if (!spanFits(board, span, col, row)) {
    return false;
  }
  const { cols } = boardSize(board);
  const { w, h } = spanSize(span);
  for (let dy = 0; dy < h; dy += 1) {
    for (let dx = 0; dx < w; dx += 1) {
      if (occupied[cellIndex(cols, col + dx, row + dy)]) {
        return false;
      }
    }
  }
  return true;
}

function setOccupied(
  occupied: boolean[],
  cols: number,
  span: TeaserSpan,
  col: number,
  row: number,
  value: boolean,
): void {
  const { w, h } = spanSize(span);
  for (let dy = 0; dy < h; dy += 1) {
    for (let dx = 0; dx < w; dx += 1) {
      occupied[cellIndex(cols, col + dx, row + dy)] = value;
    }
  }
}

function tilingKey(placements: TilePlacement[]): string {
  return [...placements]
    .sort((a, b) => a.row - b.row || a.col - b.col || a.span.localeCompare(b.span))
    .map((p) => `${p.row},${p.col},${p.span}`)
    .join("|");
}

export function boardTilingKey(tiling: BoardTiling): string {
  return tilingKey(tiling.placements);
}

function enumerateTilings(board: TeaserBoardId): BoardTiling[] {
  const { cols, rows } = boardSize(board);
  const cellCount = cols * rows;
  const occupied = Array.from({ length: cellCount }, () => false);
  const placements: TilePlacement[] = [];
  const found = new Map<string, BoardTiling>();

  function search(): void {
    const empty = firstEmptyCell(occupied, cols, rows);
    if (empty === null) {
      const snapshot = placements.map((p) => ({ ...p }));
      found.set(tilingKey(snapshot), { board, placements: snapshot });
      return;
    }

    for (const span of ALL_SPANS) {
      if (!canPlace(board, occupied, span, empty.col, empty.row)) {
        continue;
      }
      placements.push({ span, col: empty.col, row: empty.row });
      setOccupied(occupied, cols, span, empty.col, empty.row, true);
      search();
      setOccupied(occupied, cols, span, empty.col, empty.row, false);
      placements.pop();
    }
  }

  search();
  return [...found.values()];
}

export function listFullTilings(board: TeaserBoardId): BoardTiling[] {
  const cached = tilingCache.get(board);
  if (cached) {
    return cached;
  }
  const tilings = enumerateTilings(board);
  tilingCache.set(board, tilings);
  return tilings;
}

export function isCompleteTiling(tiling: BoardTiling): boolean {
  const { cols, rows } = boardSize(tiling.board);
  const cellCount = cols * rows;
  const occupied = Array.from({ length: cellCount }, () => false);

  let covered = 0;
  for (const placement of tiling.placements) {
    if (
      !canPlace(
        tiling.board,
        occupied,
        placement.span,
        placement.col,
        placement.row,
      )
    ) {
      return false;
    }
    setOccupied(
      occupied,
      cols,
      placement.span,
      placement.col,
      placement.row,
      true,
    );
    const { w, h } = spanSize(placement.span);
    covered += w * h;
  }

  if (covered !== cellCount) {
    return false;
  }
  return occupied.every((cell) => cell);
}

export function listAllowedCompositionsForBoard(
  board: TeaserBoardId,
): TeaserComposition[] {
  return listAllowedCompositions().filter((c) =>
    isSpanAllowedOnBoard(board, c.span),
  );
}

/**
 * Filter an existing candidate pool to spans allowed on `board`.
 * Preserves order and object identity — does not rebuild the source list.
 */
export function narrowToBoard<T>(
  items: readonly T[],
  board: TeaserBoardId,
  getSpan: (item: T) => TeaserSpan,
): T[] {
  return items.filter((item) => isSpanAllowedOnBoard(board, getSpan(item)));
}
