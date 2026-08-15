import { COVER_DOMINANT_RATIO } from "../../lib/teaser-layout/cover-image-form";

/** Prefetch band so masonry covers decode before they enter the scrollport. */
export const COVER_DECODE_ROOT_MARGIN = "400px 0px";

/** Displayed `<img>` is the only decode path; eager only when attached. */
export const COVER_IMG_LOADING_PRIORITY = "eager" as const;

/**
 * Mount the displayed `<img>` (the only decode path) when the card is
 * near the scrollport, or keep it after a successful decode.
 * Offscreen cards that have not decoded must not attach src.
 */
export function shouldAttachCoverSrc(args: {
  nearViewport: boolean;
  decodedCoverSrc: string | null;
  expectedCoverSrc: string | null;
}): boolean {
  if (args.decodedCoverSrc !== null) {
    return true;
  }
  if (args.expectedCoverSrc === null) {
    return false;
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

export function isPortraitCoverNaturalSize(
  width: number,
  height: number,
): boolean {
  if (width === 0) {
    return false;
  }
  return height / width >= COVER_DOMINANT_RATIO;
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
