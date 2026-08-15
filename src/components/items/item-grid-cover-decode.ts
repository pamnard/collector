import { COVER_DOMINANT_RATIO } from "../../lib/teaser-layout/cover-image-form.ts";

export const ITEM_GRID_COVER_DECODE_TIMEOUT_MS = 4_000;

export function isPortraitNaturalSize(img: HTMLImageElement): boolean {
  if (img.naturalWidth === 0) {
    return false;
  }
  return img.naturalHeight / img.naturalWidth >= COVER_DOMINANT_RATIO;
}

/** Browser decode state for a DOM `<img>` (including already-cached completes). */
export type DomImgDecodeState = "pending" | "loaded" | "broken";

export function readDomImgDecodeState(
  img: Pick<HTMLImageElement, "complete" | "naturalWidth">,
): DomImgDecodeState {
  if (!img.complete) {
    return "pending";
  }
  if (img.naturalWidth === 0) {
    return "broken";
  }
  return "loaded";
}

/**
 * If the img is already complete (browser cache), settle via the same paths as
 * onLoad/onError — otherwise onLoad may never fire and the card sticks on the
 * placeholder until timeout.
 */
export function settleDomImgCoverDecode(
  img: HTMLImageElement,
  handlers: {
    onLoad: (img: HTMLImageElement) => void;
    onError: () => void;
  },
): boolean {
  const state = readDomImgDecodeState(img);
  if (state === "pending") {
    return false;
  }
  if (state === "broken") {
    handlers.onError();
    return true;
  }
  handlers.onLoad(img);
  return true;
}

export type ItemGridCoverDecodePlan =
  | { kind: "wait-path" }
  | { kind: "settled-empty" }
  | { kind: "defer"; src: string }
  | { kind: "decode"; src: string };

/**
 * Decide whether to start, defer, or skip cover decode for a grid card.
 * Offscreen cards defer until `shouldDecode` (near-viewport) is true.
 * Once decode has started for `src`, leaving the near zone does not abort
 * (wait-path) — boundary thrashing must not clear coverSrc / remount img.
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
    // Keep settled covers and in-flight decode across near-zone thrashing.
    // Aborting mid-decode clears coverSrc and restarts decode on re-entry.
    if (args.currentSrc === src) {
      return { kind: "wait-path" };
    }
    return { kind: "defer", src };
  }

  return { kind: "decode", src };
}
