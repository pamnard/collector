import type { CSSProperties } from "react";

/** Decoded cover pixel size used to reserve masonry teaser layout. */
export type ItemGridCoverPixelSize = {
  width: number;
  height: number;
};

/** Pure cover-slot flags for ItemGridCard (keeps failed loads from sticky gray teasers). */
export function itemGridCoverSlot(args: {
  expectedCoverSrc: string | null;
  coverSrc: string | null;
  coverSettled: boolean;
}): { coverPending: boolean; showCover: boolean; loadCover: boolean } {
  const coverPending = Boolean(args.expectedCoverSrc) && !args.coverSettled;
  const showCover = Boolean(args.coverSrc && args.coverSettled);
  const loadCover = Boolean(args.coverSrc) && !args.coverSettled;
  return { coverPending, showCover, loadCover };
}

/**
 * Capture natural pixels from a decoded cover `<img>` for layout reservation.
 * Visible covers must not rely on post-paint intrinsic sizing alone.
 */
export function itemGridCoverPixelSizeFromImg(
  img: Pick<HTMLImageElement, "naturalWidth" | "naturalHeight">,
): ItemGridCoverPixelSize {
  if (!(img.naturalWidth > 0) || !(img.naturalHeight > 0)) {
    throw new Error("cover natural size must be positive");
  }
  return { width: img.naturalWidth, height: img.naturalHeight };
}

/** Explicit HTML width/height attrs (Lighthouse unsized-images). */
export function itemGridCoverImgSizeAttrs(
  size: ItemGridCoverPixelSize,
): { width: number; height: number } {
  return { width: size.width, height: size.height };
}

/**
 * Stable aspect box for the cover slot — owns teaser height before/while the
 * visible `<img>` paints. Ratio matches decoded pixels (no vault schema).
 */
export function itemGridCoverSlotAspectStyle(
  size: ItemGridCoverPixelSize,
): CSSProperties {
  return { aspectRatio: `${size.width} / ${size.height}` };
}

/**
 * Cover `<img>` layout classes.
 * Settled covers fill the reserved aspect slot (not `h-auto` alone).
 * In-flight decode uses a detached 1×1 img in ItemGridCard — not this helper.
 */
export function itemGridCoverImgClassName(args: { loadCover: boolean }): string {
  if (args.loadCover) {
    return "absolute inset-0 h-full w-full opacity-0";
  }
  return "absolute inset-0 h-full w-full";
}
