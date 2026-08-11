import type { ImageForm } from "./composition";

/** Same threshold as collection grid covers (`useItemGridCover`). */
export const COVER_DOMINANT_RATIO = 1.2;

export type CoverImageForm = Exclude<ImageForm, "none">;

/**
 * Bucket cover pixel size into composition image form.
 * Portrait/landscape when the tall/wide side dominates by {@link COVER_DOMINANT_RATIO};
 * otherwise square.
 */
export function measureCoverImageForm(
  widthPx: number,
  heightPx: number,
): CoverImageForm {
  if (!(widthPx > 0) || !(heightPx > 0)) {
    throw new Error("cover dimensions must be positive");
  }
  if (heightPx / widthPx >= COVER_DOMINANT_RATIO) {
    return "portrait";
  }
  if (widthPx / heightPx >= COVER_DOMINANT_RATIO) {
    return "landscape";
  }
  return "square";
}
