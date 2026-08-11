import type { RelatedTeaser } from "../related-teaser";
import type { TeaserBoardId } from "./board";
import {
  compositionId,
  type TeaserComposition,
  type TeaserSpan,
} from "./composition";
import { compositionsFittingCandidate } from "./candidate-fit";
import { MIN_LAYOUT_SCORE, scoreLayout, scoreSlot } from "./layout-score";
import {
  boardTilingKey,
  listFullTilings,
  type BoardTiling,
  type TilePlacement,
} from "./tiling";

export type LayoutSlotAssignment = {
  span: TeaserSpan;
  col: number;
  row: number;
  teaserId: string;
  composition: TeaserComposition;
};

export type LayoutPick = {
  board: TeaserBoardId;
  slots: LayoutSlotAssignment[];
  score: number;
};

function sortPlacements(placements: TilePlacement[]): TilePlacement[] {
  return [...placements].sort(
    (a, b) => a.row - b.row || a.col - b.col || a.span.localeCompare(b.span),
  );
}

function bestCompositionForSlot(
  teaser: RelatedTeaser,
  span: TeaserSpan,
  board: TeaserBoardId,
): TeaserComposition | null {
  const fits = compositionsFittingCandidate(teaser, span, board);
  if (fits.length === 0) {
    return null;
  }
  let best = fits[0];
  let bestScore = scoreSlot(teaser, best);
  for (let i = 1; i < fits.length; i += 1) {
    const candidate = fits[i];
    const score = scoreSlot(teaser, candidate);
    if (
      score > bestScore ||
      (score === bestScore &&
        compositionId(candidate) < compositionId(best))
    ) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function tryAssignTiling(
  teasers: readonly RelatedTeaser[],
  tiling: BoardTiling,
): LayoutPick | null {
  const used = new Set<string>();
  const slots: LayoutSlotAssignment[] = [];
  const scored: { teaser: RelatedTeaser; composition: TeaserComposition }[] =
    [];

  for (const placement of sortPlacements(tiling.placements)) {
    let assigned: LayoutSlotAssignment | null = null;
    let assignedTeaser: RelatedTeaser | null = null;

    for (const teaser of teasers) {
      if (used.has(teaser.id)) {
        continue;
      }
      const composition = bestCompositionForSlot(
        teaser,
        placement.span,
        tiling.board,
      );
      if (composition === null) {
        continue;
      }
      assigned = {
        span: placement.span,
        col: placement.col,
        row: placement.row,
        teaserId: teaser.id,
        composition,
      };
      assignedTeaser = teaser;
      break;
    }

    if (assigned === null || assignedTeaser === null) {
      return null;
    }
    used.add(assigned.teaserId);
    slots.push(assigned);
    scored.push({
      teaser: assignedTeaser,
      composition: assigned.composition,
    });
  }

  const score = scoreLayout(scored);
  if (score < MIN_LAYOUT_SCORE) {
    return null;
  }

  return {
    board: tiling.board,
    slots,
    score,
  };
}

function teaserIdKey(slots: LayoutSlotAssignment[]): string {
  return slots.map((s) => s.teaserId).join("\0");
}

function isBetterPick(next: LayoutPick, current: LayoutPick, nextTiling: BoardTiling, currentTiling: BoardTiling): boolean {
  if (next.score !== current.score) {
    return next.score > current.score;
  }
  const nextKey = boardTilingKey(nextTiling);
  const currentKey = boardTilingKey(currentTiling);
  if (nextKey !== currentKey) {
    return nextKey < currentKey;
  }
  return teaserIdKey(next.slots) < teaserIdKey(current.slots);
}

/**
 * Pick one complete layout for `board` from the given candidate pool, or null.
 * Does not fetch or rebuild candidates — callers pass the same list when shrinking.
 */
export function pickTeaserLayout(
  teasers: readonly RelatedTeaser[],
  board: TeaserBoardId,
): LayoutPick | null {
  if (teasers.length === 0) {
    return null;
  }

  let best: LayoutPick | null = null;
  let bestTiling: BoardTiling | null = null;

  for (const tiling of listFullTilings(board)) {
    const pick = tryAssignTiling(teasers, tiling);
    if (pick === null) {
      continue;
    }
    if (
      best === null ||
      bestTiling === null ||
      isBetterPick(pick, best, tiling, bestTiling)
    ) {
      best = pick;
      bestTiling = tiling;
    }
  }

  return best;
}
