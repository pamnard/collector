import type { RelatedTeaser } from "../related-teaser";
import {
  isSpanAllowedOnBoard,
  type TeaserBoardId,
} from "./board";
import {
  isAllowedComposition,
  listAllowedCompositionsForSpan,
  type DescLen,
  type TeaserComposition,
  type TeaserSpan,
  type TitleLen,
} from "./composition";

/** Title length buckets for composition matching. */
export const TITLE_SHORT_MAX = 40;
export const TITLE_MEDIUM_MAX = 80;

/** Description length buckets for composition matching. */
export const DESC_SHORT_MAX = 120;

export function measureTitleLen(title: string): TitleLen {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    return "none";
  }
  if (trimmed.length <= TITLE_SHORT_MAX) {
    return "short";
  }
  if (trimmed.length <= TITLE_MEDIUM_MAX) {
    return "medium";
  }
  return "long";
}

export function measureDescLen(description: string): DescLen {
  const trimmed = description.trim();
  if (trimmed.length === 0) {
    return "none";
  }
  if (trimmed.length <= DESC_SHORT_MAX) {
    return "short";
  }
  return "long";
}

/** Axis match against an already-allowed composition (no blacklist re-check). */
export function teaserMatchesCompositionAxes(
  teaser: RelatedTeaser,
  composition: TeaserComposition,
  titleLen: TitleLen = measureTitleLen(teaser.title),
  descLen: DescLen = measureDescLen(teaser.description),
): boolean {
  const hasThumbnail = teaser.thumbnail != null && teaser.thumbnail.length > 0;
  if (composition.hasImage) {
    if (!hasThumbnail) {
      return false;
    }
    if (composition.form === "none") {
      return false;
    }
  } else if (composition.form !== "none") {
    return false;
  }

  if (composition.hasTitle) {
    if (titleLen === "none") {
      return false;
    }
    if (composition.titleLen !== titleLen) {
      return false;
    }
  } else if (composition.titleLen !== "none" || titleLen !== "none") {
    return false;
  }

  if (composition.desc !== descLen) {
    return false;
  }

  if (composition.extra === "none") {
    return true;
  }
  if (teaser.createdAt.trim().length === 0) {
    return false;
  }
  if (composition.extra === "date_type" && teaser.contentType.trim().length === 0) {
    return false;
  }
  return true;
}

export function teaserFitsComposition(
  teaser: RelatedTeaser,
  composition: TeaserComposition,
): boolean {
  if (!isAllowedComposition(composition)) {
    return false;
  }
  return teaserMatchesCompositionAxes(teaser, composition);
}

export function compositionsFittingCandidate(
  teaser: RelatedTeaser,
  span: TeaserSpan,
  board: TeaserBoardId,
): TeaserComposition[] {
  if (!isSpanAllowedOnBoard(board, span)) {
    return [];
  }
  const titleLen = measureTitleLen(teaser.title);
  const descLen = measureDescLen(teaser.description);
  return listAllowedCompositionsForSpan(span).filter((c) =>
    teaserMatchesCompositionAxes(teaser, c, titleLen, descLen),
  );
}
