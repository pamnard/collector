/** Capacity of the current fixed related layout (6 × text teaser). TODO(#605): dynamic. */
export const RELATED_PANEL_SIZE = 6;

/**
 * Teaser fed into the related panel. Layout (#605) consumes this list;
 * selection (fallback / embeddings / pins) stays outside.
 */
export type RelatedTeaser = {
  id: string;
  title: string;
  /** Cover path when present; image form/aspect is not invented here (#609). */
  thumbnail: string | null;
  /** Item description as stored (may be empty). */
  description: string;
  createdAt: string;
  contentType: string;
};
