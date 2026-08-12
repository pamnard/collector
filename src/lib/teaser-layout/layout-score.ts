import type { RelatedTeaser } from "../related-teaser";
import { spanSize } from "./board";
import type { CoverImageForm } from "./cover-image-form";
import type { TeaserComposition, TeaserSpan } from "./composition";

/** Minimum layout score for a complete fill to be accepted (#611). */
export const MIN_LAYOUT_SCORE = 1;

/**
 * Soft structure weights for beauty pick (#611).
 * Content score alone gates accept/reject; these terms only rank valid tilings
 * and must not reject a mono layout when the pool cannot support anything else.
 */
export const LEFT_MASS_WEIGHT = 3;
/** Keep mild — strong values make 1×1 grids lose to 2×1 slabs. */
export const SMALL_SPAN_LEFT_PENALTY = 4;
export const SPAN_DIVERSITY_WEIGHT = 30;
/**
 * Soft demotion for vertically stacked wide bands (2×1 slabs).
 * Must beat residual wide-band preference when a mixed tiling exists.
 */
export const FULL_WIDTH_STACK_PENALTY = 80;
/** Soft preference: tall 1×2 over wide 2×1; also helps 1×1 grids beat 2×1 slabs. */
export const TALL_SPAN_PREF = 10;
export const WIDE_SPAN_COST = 14;

/** Prefer spans that match the measured cover form. */
export function formSpanFitBonus(
  imageForm: CoverImageForm | null,
  span: TeaserSpan,
): number {
  if (imageForm === null) {
    return 0;
  }
  if (imageForm === "portrait") {
    if (span === "1x2") {
      return 8;
    }
    if (span === "2x2") {
      return 4;
    }
    return 0;
  }
  if (imageForm === "landscape") {
    // Prefer a large 2×2 (or 1×1 grid) over a wide 2×1 slab.
    if (span === "2x2") {
      return 4;
    }
    return 0;
  }
  // square
  if (span === "2x2") {
    return 4;
  }
  if (span === "1x1") {
    return 2;
  }
  return 0;
}

export function scoreSlot(
  teaser: RelatedTeaser,
  composition: TeaserComposition,
): number {
  let score = 0;
  if (composition.hasImage) {
    if (teaser.thumbnail != null && teaser.thumbnail.length > 0) {
      score += 3;
    }
  } else {
    score += 1;
  }
  if (composition.desc !== "none" && teaser.description.trim().length > 0) {
    score += 1;
  }
  if (composition.extra !== "none") {
    score += 1;
  }
  score += formSpanFitBonus(
    composition.hasImage ? teaser.imageForm : null,
    composition.span,
  );
  return score;
}

/** Soft bonus: more distinct spans → higher score (2×1 slabs do not count). */
export function layoutDiversityBonus(spans: readonly TeaserSpan[]): number {
  if (spans.length === 0) {
    throw new Error("diversity bonus requires at least one span");
  }
  const distinct = new Set(spans.filter((span) => span !== "2x1")).size;
  // Mono-2×1 still gets a baseline so soft ranking does not hard-reject it.
  const effective = distinct > 0 ? distinct : 1;
  return effective * effective * SPAN_DIVERSITY_WEIGHT;
}

/**
 * Soft orientation bias: prefer tall 1×2, demote wide 2×1.
 * Does not reject mono-2×1 when that is the only complete fill.
 */
export function layoutSpanOrientationBias(
  spans: readonly TeaserSpan[],
): number {
  let total = 0;
  for (const span of spans) {
    if (span === "1x2") {
      total += TALL_SPAN_PREF;
    } else if (span === "2x1") {
      total -= WIDE_SPAN_COST;
    }
  }
  return total;
}

/** Soft bonus: visual mass toward the left; 1×1 nudged right. */
export function layoutLeftMassBonus(
  slots: readonly { span: TeaserSpan; col: number }[],
  boardCols: number,
): number {
  if (!(boardCols > 0)) {
    throw new Error("board cols must be positive");
  }
  let total = 0;
  for (const slot of slots) {
    if (slot.col < 0 || slot.col >= boardCols) {
      throw new Error("slot col must lie on the board");
    }
    const { w, h } = spanSize(slot.span);
    const mass = w * h;
    const leftness = boardCols - slot.col;
    total += mass * leftness * LEFT_MASS_WEIGHT;
    if (mass <= 1) {
      total -= leftness * SMALL_SPAN_LEFT_PENALTY;
    }
  }
  return total;
}

/**
 * Soft penalty for vertically stacked wide horizontal bands (2×1).
 * Applies even when other slots exist on the board (side column, etc.).
 * Side-by-side wide bands on the same row are not stacked.
 */
export function layoutFullWidthStackPenalty(
  slots: readonly { span: TeaserSpan; col: number; row: number }[],
  boardCols: number,
): number {
  if (!(boardCols > 0)) {
    throw new Error("board cols must be positive");
  }
  if (slots.length < 2) {
    return 0;
  }

  const wideBands = slots.filter((slot) => {
    const { w, h } = spanSize(slot.span);
    return h === 1 && w >= 2;
  });
  if (wideBands.length < 2) {
    return 0;
  }

  const countByCol = new Map<number, number>();
  for (const band of wideBands) {
    countByCol.set(band.col, (countByCol.get(band.col) ?? 0) + 1);
  }

  let stackedBandCount = 0;
  for (const count of countByCol.values()) {
    if (count >= 2) {
      stackedBandCount += count;
    }
  }
  if (stackedBandCount < 2) {
    return 0;
  }
  return FULL_WIDTH_STACK_PENALTY * stackedBandCount;
}

/** Sum of per-slot content scores (accept/reject gate, no structure terms). */
export function layoutContentScore(
  slots: readonly {
    teaser: RelatedTeaser;
    composition: TeaserComposition;
  }[],
): number {
  if (slots.length === 0) {
    throw new Error("layout score requires at least one slot");
  }
  let total = 0;
  for (const slot of slots) {
    total += scoreSlot(slot.teaser, slot.composition);
  }
  return total;
}

/**
 * Beauty score = content + soft structure terms.
 * Pass `contentScore` when already computed for the MIN_LAYOUT_SCORE gate.
 */
export function scoreLayout(
  slots: readonly {
    teaser: RelatedTeaser;
    composition: TeaserComposition;
    col: number;
    row: number;
  }[],
  boardCols: number,
  contentScore: number = layoutContentScore(slots),
): number {
  const spans = slots.map((s) => s.composition.span);
  const placed = slots.map((s) => ({
    span: s.composition.span,
    col: s.col,
    row: s.row,
  }));
  return (
    contentScore +
    layoutDiversityBonus(spans) +
    layoutSpanOrientationBias(spans) +
    layoutLeftMassBonus(placed, boardCols) -
    layoutFullWidthStackPenalty(placed, boardCols)
  );
}
