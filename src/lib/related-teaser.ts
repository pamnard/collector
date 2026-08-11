import type { ItemFile } from "@collector/shared";
import type { CoverImageForm } from "./teaser-layout/cover-image-form";

/** Candidate pool size for related layout (#612): max cells on board 4×2. */
export const RELATED_PANEL_SIZE = 8;

/**
 * Teaser fed into the related panel. Layout (#605) consumes this list;
 * selection (embeddings / pins) stays outside.
 * `thumbnail` is the same display cover URL as collection cards
 * ({@link resolveCoverSrc} after `UiSession.thumbnails`).
 * `imageForm` is measured from that cover; null when there is no cover or
 * dimensions could not be read (no invented form).
 */
export type RelatedTeaser = {
  id: string;
  title: string;
  /** Display cover URL when present (disk resolve or YouTube); not FM raw. */
  thumbnail: string | null;
  /** Measured cover form when `thumbnail` loaded; never guessed. */
  imageForm: CoverImageForm | null;
  /** Item description as stored (may be empty). */
  description: string;
  createdAt: string;
  contentType: string;
};

/** Map a hydrated item + resolved cover into a layout teaser. */
export function relatedTeaserFromItem(
  item: ItemFile,
  thumbnail: string | null,
  imageForm: CoverImageForm | null,
): RelatedTeaser {
  if (thumbnail === null && imageForm !== null) {
    throw new Error(
      `related teaser ${item.id}: imageForm requires a resolved cover URL`,
    );
  }
  return {
    id: item.id,
    title: item.title,
    thumbnail,
    imageForm,
    description: item.description,
    createdAt: item.created_at,
    contentType: item.content_type,
  };
}
