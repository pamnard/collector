/**
 * Masonry cover decode priority (#660).
 * Image() probe is the single intentional decode path; the display <img> stays lazy.
 * Near-viewport gating avoids offscreen cards contending on decode.
 */

/** Ahead of infinite-scroll (240px) so covers settle before cards enter the scrollport. */
export const COVER_DECODE_ROOT_MARGIN = "480px";

/** Display <img> must not use eager — decode ownership is the gated Image() probe. */
export const ITEM_GRID_COVER_IMG_LOADING = "lazy" as const;

/** Start pixel probe only for near-viewport cards with a concrete cover URL. */
export function shouldProbeCoverPixels(args: {
  nearViewport: boolean;
  coverSrc: string | null;
}): boolean {
  return args.nearViewport && args.coverSrc !== null;
}

/**
 * When the path is known and there is nothing to decode, settle immediately
 * (no Image() / no decode contention) even if the card is still offscreen.
 */
export function shouldSettleCoverWithoutProbe(args: {
  thumbnailPath: string | null | undefined;
  coverSrc: string | null;
}): boolean {
  return args.thumbnailPath !== undefined && args.coverSrc === null;
}
