/**
 * Same threshold as COVER_DOMINANT_RATIO in cover-image-form.ts.
 * Kept local so node:test can load this module without JSON composition deps.
 */
export const COVER_DECODE_PORTRAIT_RATIO = 1.2;

/** Prefetch band so masonry covers decode before they enter the scrollport. */
export const COVER_DECODE_ROOT_MARGIN = "400px 0px";

/** Displayed `<img>` is the only decode path; eager only when attached. */
export const COVER_IMG_LOADING_PRIORITY = "eager" as const;

/**
 * Mount the displayed `<img>` (the only decode path) when the card is
 * near the scrollport, or keep it after a successful decode of this src.
 * Offscreen cards that have not decoded the current src must not attach.
 */
export function shouldAttachCoverSrc(args: {
  nearViewport: boolean;
  decodedCoverSrc: string | null;
  expectedCoverSrc: string | null;
}): boolean {
  if (args.expectedCoverSrc === null) {
    return false;
  }
  if (args.decodedCoverSrc === args.expectedCoverSrc) {
    return true;
  }
  return args.nearViewport;
}

/** Timeout only while the displayed img is actually decoding. */
export function shouldRunCoverDecodeTimeout(args: {
  attachCover: boolean;
  coverSettled: boolean;
  expectedCoverSrc: string | null;
}): boolean {
  return (
    args.attachCover && !args.coverSettled && args.expectedCoverSrc !== null
  );
}

/** Do not invent a viewport root — wait for the masonry scrollport. */
export function shouldObserveNearViewport(args: {
  node: Element | null;
  root: Element | null;
}): args is { node: Element; root: Element } {
  return args.node !== null && args.root !== null;
}

export function isCoverImgEventForSrc(
  imgSrcAttr: string | null,
  expectedSrc: string | null,
): expectedSrc is string {
  return expectedSrc !== null && imgSrcAttr === expectedSrc;
}

export function isPortraitCoverNaturalSize(
  width: number,
  height: number,
): boolean {
  if (width === 0) {
    return false;
  }
  return height / width >= COVER_DECODE_PORTRAIT_RATIO;
}

export function applyCoverDecodeLoad(args: {
  flightId: number;
  eventFlightId: number;
  expectedSrc: string | null;
  imgSrcAttr: string | null;
  width: number;
  height: number;
}): { coverSrc: string; isPortrait: boolean } | null {
  if (args.flightId !== args.eventFlightId) {
    return null;
  }
  if (!isCoverImgEventForSrc(args.imgSrcAttr, args.expectedSrc)) {
    return null;
  }
  return {
    coverSrc: args.expectedSrc,
    isPortrait: isPortraitCoverNaturalSize(args.width, args.height),
  };
}

export function applyCoverDecodeFail(args: {
  flightId: number;
  eventFlightId: number;
}): { coverSrc: null; isPortrait: false } | null {
  if (args.flightId !== args.eventFlightId) {
    return null;
  }
  return { coverSrc: null, isPortrait: false };
}

export type ItemGridCardMemoSnapshot = {
  id: string;
  coverStamp: string;
  thumbnailPath: string | null | undefined;
  title: string;
  description: string | null | undefined;
  contentType: string | undefined;
  createdAt: string;
  url: string | null | undefined;
  tagIds: readonly string[];
};

export function itemGridCardMemoSnapshot(args: {
  id: string;
  coverStamp: string;
  thumbnailPath: string | null | undefined;
  title: string;
  description?: string | null;
  contentType?: string;
  createdAt: string;
  url?: string | null;
  tagIds: readonly string[];
}): ItemGridCardMemoSnapshot {
  return {
    id: args.id,
    coverStamp: args.coverStamp,
    thumbnailPath: args.thumbnailPath,
    title: args.title,
    description: args.description,
    contentType: args.contentType,
    createdAt: args.createdAt,
    url: args.url,
    tagIds: args.tagIds,
  };
}

export function itemGridCardMemoSnapshotsEqual(
  left: ItemGridCardMemoSnapshot,
  right: ItemGridCardMemoSnapshot,
): boolean {
  if (
    left.id !== right.id ||
    left.coverStamp !== right.coverStamp ||
    left.thumbnailPath !== right.thumbnailPath ||
    left.title !== right.title ||
    left.description !== right.description ||
    left.contentType !== right.contentType ||
    left.createdAt !== right.createdAt ||
    left.url !== right.url
  ) {
    return false;
  }
  if (left.tagIds.length !== right.tagIds.length) {
    return false;
  }
  return left.tagIds.every((id, index) => id === right.tagIds[index]);
}
