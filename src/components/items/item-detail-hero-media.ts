/** Detail hero media layout helpers. */

/**
 * Collapsed (16:9 crop) vs expanded (full intrinsic height) image classes.
 * Expanded must use in-flow `h-auto` so the block grows with the image —
 * never keep a fixed AspectRatio box and only swap object-fit (#800 regression).
 */
export function itemDetailHeroImgClassName(expanded: boolean): string {
  if (expanded) {
    return "h-auto w-full rounded-lg";
  }
  return "absolute inset-0 h-full w-full rounded-lg object-cover";
}
