import type { CoverImageForm } from "./teaser-layout/cover-image-form";

/** Candidate pool size for related layout (#612): max cells on board 4×2. */
export const RELATED_PANEL_SIZE = 8;

/**
 * Teaser fed into the related panel. Layout (#605) consumes this list;
 * selection (fallback / embeddings / pins) stays outside.
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
