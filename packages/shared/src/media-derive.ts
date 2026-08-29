/**
 * Host `/media/derive` width contract (#882 / #879).
 * Whitelist is shared by host validation and UI slot fit.
 */

export const MEDIA_DERIVE_WIDTHS = [
  128, 256, 384, 480, 640, 768, 960, 1280, 1600, 1920,
] as const;

export type MediaDeriveWidth = (typeof MEDIA_DERIVE_WIDTHS)[number];

export const MEDIA_DERIVE_MAX_WIDTH = 1920 satisfies MediaDeriveWidth;

/** Fixed default encode quality (cache key + sharp). */
export const MEDIA_DERIVE_WEBP_QUALITY = 85;

const WIDTH_SET: ReadonlySet<number> = new Set(MEDIA_DERIVE_WIDTHS);

export function isMediaDeriveWhitelistWidth(w: number): w is MediaDeriveWidth {
  return WIDTH_SET.has(w);
}

/**
 * `needed_w ≈ ceil(slot_css_width × dpr)` → nearest whitelist step ≥ that value,
 * then conceptually `min(step, source_natural_width)` by capping the needed
 * width before stepping (request stays on the whitelist; host still never upscales).
 */
export function pickMediaDeriveWidth(
  neededWidthPx: number,
  sourceNaturalWidth?: number,
): MediaDeriveWidth {
  if (!(neededWidthPx > 0) || !Number.isFinite(neededWidthPx)) {
    throw new Error(`derive needed width must be a positive finite number, got ${neededWidthPx}`);
  }
  if (
    sourceNaturalWidth !== undefined &&
    (!(sourceNaturalWidth > 0) || !Number.isFinite(sourceNaturalWidth))
  ) {
    throw new Error(
      `derive source width must be a positive finite number when provided, got ${sourceNaturalWidth}`,
    );
  }

  const target =
    sourceNaturalWidth === undefined
      ? neededWidthPx
      : Math.min(neededWidthPx, sourceNaturalWidth);

  for (const step of MEDIA_DERIVE_WIDTHS) {
    if (step >= target) {
      return step;
    }
  }
  return MEDIA_DERIVE_MAX_WIDTH;
}
