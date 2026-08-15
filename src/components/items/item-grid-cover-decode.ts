import { COVER_DOMINANT_RATIO } from "../../lib/teaser-layout/cover-image-form.ts";

export const ITEM_GRID_COVER_DECODE_TIMEOUT_MS = 4_000;

export function isPortraitNaturalSize(img: HTMLImageElement): boolean {
  if (img.naturalWidth === 0) {
    return false;
  }
  return img.naturalHeight / img.naturalWidth >= COVER_DOMINANT_RATIO;
}

export type ItemGridCoverDecodePlan =
  | { kind: "wait-path" }
  | { kind: "settled-empty" }
  | { kind: "defer"; src: string }
  | { kind: "decode"; src: string };

/**
 * Decide whether to start, defer, or skip cover decode for a grid card.
 * Offscreen cards defer until `shouldDecode` (near-viewport) is true.
 */
export function planItemGridCoverDecode(args: {
  thumbnailPath: string | null | undefined;
  resolvedSrc: string | null;
  shouldDecode: boolean;
  currentSrc: string | null;
  currentSettled: boolean;
}): ItemGridCoverDecodePlan {
  if (args.thumbnailPath === undefined) {
    return { kind: "wait-path" };
  }

  const src = args.resolvedSrc;
  if (src !== null && src === args.currentSrc && args.currentSettled) {
    return { kind: "wait-path" };
  }

  if (!src) {
    return { kind: "settled-empty" };
  }

  if (!args.shouldDecode) {
    if (args.currentSrc === src && args.currentSettled) {
      return { kind: "wait-path" };
    }
    return { kind: "defer", src };
  }

  return { kind: "decode", src };
}
