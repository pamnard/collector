/** Reserved hero box for item detail — UI-only size reservation (no vault schema). */

export const DETAIL_HERO_MEDIA_WIDTH = 1600;
export const DETAIL_HERO_MEDIA_HEIGHT = 900;
export const DETAIL_HERO_ASPECT_RATIO =
  DETAIL_HERO_MEDIA_WIDTH / DETAIL_HERO_MEDIA_HEIGHT;

/**
 * Layout classes for the detail hero `<img>`.
 * Always fill a pre-sized aspect box — never `h-auto` (CLS from intrinsic decode).
 */
export function itemDetailHeroImgClassName(expanded: boolean): string {
  const fit = expanded ? "object-contain" : "object-cover";
  return `absolute inset-0 h-full w-full rounded-lg ${fit}`;
}
