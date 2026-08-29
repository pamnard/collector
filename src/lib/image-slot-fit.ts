/**
 * Product display-slot CSS budgets for `/media/derive` adequacy (#882 / #879).
 * Runtime helpers take measured CSS width; this catalog documents the slots
 * every surface must size for (grid, related, thumbnail, detail hero).
 */

import {
  pickMediaDeriveWidth,
  type MediaDeriveWidth,
} from "@collector/shared";

export type ImageDisplaySlotId =
  | "dashboard-grid"
  | "related-teaser"
  | "thumbnail"
  | "detail-hero";

export type ImageDisplaySlot = {
  id: ImageDisplaySlotId;
  /**
   * Representative CSS width (px) for the slot at a typical desktop layout.
   * Used for catalog adequacy checks — live UI passes measured width when known.
   */
  cssWidthPx: number;
};

/**
 * Adequacy catalog (typical desktop). Live related board measures cell width;
 * grid/thumbnail/hero still take catalog width until measured.
 */
export const ALL_IMAGE_DISPLAY_SLOTS: readonly ImageDisplaySlot[] = [
  { id: "dashboard-grid", cssWidthPx: 400 },
  { id: "related-teaser", cssWidthPx: 400 },
  { id: "thumbnail", cssWidthPx: 128 },
  { id: "detail-hero", cssWidthPx: 900 },
] as const;

export function imageDisplaySlotById(
  id: ImageDisplaySlotId,
): ImageDisplaySlot {
  const slot = ALL_IMAGE_DISPLAY_SLOTS.find((entry) => entry.id === id);
  if (!slot) {
    throw new Error(`unknown image display slot: ${id}`);
  }
  return slot;
}

/**
 * `needed_w ≈ ceil(slot_css_width × devicePixelRatio)` → whitelist step,
 * optionally capped by known source natural width.
 */
export function neededDeriveWidthForSlot(input: {
  slotCssWidthPx: number;
  devicePixelRatio: number;
  sourceNaturalWidth?: number;
}): MediaDeriveWidth {
  if (!(input.slotCssWidthPx > 0) || !Number.isFinite(input.slotCssWidthPx)) {
    throw new Error(
      `slot CSS width must be a positive finite number, got ${input.slotCssWidthPx}`,
    );
  }
  if (
    !(input.devicePixelRatio > 0) ||
    !Number.isFinite(input.devicePixelRatio)
  ) {
    throw new Error(
      `devicePixelRatio must be a positive finite number, got ${input.devicePixelRatio}`,
    );
  }
  const needed = Math.ceil(input.slotCssWidthPx * input.devicePixelRatio);
  return pickMediaDeriveWidth(needed, input.sourceNaturalWidth);
}

/** Whitelist steps used when building `srcset` for a CSS slot (1× and 2× DPR). */
export function deriveSrcSetWidthsForSlot(input: {
  slotCssWidthPx: number;
  sourceNaturalWidth?: number;
}): MediaDeriveWidth[] {
  const oneX = neededDeriveWidthForSlot({
    slotCssWidthPx: input.slotCssWidthPx,
    devicePixelRatio: 1,
    sourceNaturalWidth: input.sourceNaturalWidth,
  });
  const twoX = neededDeriveWidthForSlot({
    slotCssWidthPx: input.slotCssWidthPx,
    devicePixelRatio: 2,
    sourceNaturalWidth: input.sourceNaturalWidth,
  });
  if (oneX === twoX) {
    return [oneX];
  }
  return [oneX, twoX];
}
