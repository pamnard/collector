import type { CSSProperties } from "react";
import type { ItemThumbnailPixelSize } from "@collector/api";
import { measureCoverImageForm } from "../../lib/teaser-layout/cover-image-form.ts";

/** Decoded / resolved cover pixel size used to reserve masonry teaser layout. */
export type ItemGridCoverPixelSize = ItemThumbnailPixelSize;

/**
 * Portrait overlay chrome from reserved WxH — before decode settles.
 * Waiting for decode flipped meta below→overlay and jerked masonry height.
 */
export function itemGridCoverOverlayLayout(args: {
  hasCover: boolean;
  slotSize: ItemGridCoverPixelSize | null;
}): boolean {
  if (!args.hasCover || args.slotSize === null) {
    return false;
  }
  return (
    measureCoverImageForm(args.slotSize.width, args.slotSize.height) ===
    "portrait"
  );
}

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
 * Reserve cover teaser only when host already gave exact WxH (or decode settled).
 * No optimistic 16:9 / 3:4 — those jump after real pixels arrive.
 */
export function itemGridCoverSlotPending(args: {
  coverPending: boolean;
  resolvedPixelSize: ItemGridCoverPixelSize | null;
}): boolean {
  const size = args.resolvedPixelSize;
  return (
    args.coverPending &&
    size != null &&
    size.width > 0 &&
    size.height > 0
  );
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
 * visible `<img>` paints. Ratio matches resolved or decoded pixels.
 */
export function itemGridCoverSlotAspectStyle(
  size: ItemGridCoverPixelSize,
): CSSProperties {
  return { aspectRatio: `${size.width} / ${size.height}` };
}

/**
 * Cover `<img>` layout classes.
 * Settled covers fill the reserved aspect slot (not `h-auto` alone).
 * In-flight decode uses opacity-0 over the reserved slot.
 */
export function itemGridCoverImgClassName(args: { loadCover: boolean }): string {
  if (args.loadCover) {
    return "absolute inset-0 h-full w-full opacity-0";
  }
  return "absolute inset-0 h-full w-full";
}
