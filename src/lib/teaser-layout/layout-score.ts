import type { RelatedTeaser } from "../related-teaser";
import type { TeaserComposition } from "./composition";

/** Minimum layout score for a complete fill to be accepted (#611). */
export const MIN_LAYOUT_SCORE = 1;

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
  return score;
}

export function scoreLayout(
  slots: readonly {
    teaser: RelatedTeaser;
    composition: TeaserComposition;
  }[],
): number {
  let total = 0;
  for (const slot of slots) {
    total += scoreSlot(slot.teaser, slot.composition);
  }
  return total;
}
