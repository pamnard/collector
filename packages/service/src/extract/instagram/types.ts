/**
 * Shared Instagram extract contracts (align with #846/#847/#848/#318).
 * Defined here so merge (#848) stays standalone until siblings land.
 */

export type InstagramMediaKind = "image" | "video";

export type InstagramFetchedMedia = {
  kind: InstagramMediaKind;
  /** CDN URL */
  url: string;
  suggestedFilename?: string;
};

/** Successful fetch payload — input to same-item merge. */
export type InstagramFetchSuccess = {
  sourceUrl: string;
  shortcode: string;
  /** Without leading `@`. */
  authorUsername: string;
  caption: string | null;
  /**
   * Accessibility / alt text when Instagram provides it — not invented ASR.
   */
  accessibilityCaption: string | null;
  /** All carousel items when present; non-empty on success. */
  media: InstagramFetchedMedia[];
};

export type InstagramMediaIntent = {
  kind: InstagramMediaKind;
  sourceUrl: string;
  filename: string;
};

/**
 * Pure same-item merge result for assembly (#318) to apply via updateItem /
 * attachMediaFiles. No vault I/O here.
 *
 * #318 content_type recommendation: set `content_type` to `"note"` after a
 * successful merge (normal note + attached media). The repo has no
 * Instagram-specific content_type; media kind belongs on attachments.
 */
export type InstagramMergeResult = {
  title: string;
  body: string;
  url: string;
  mediaIntents: InstagramMediaIntent[];
};

/** Minimal note snapshot needed for body preserve / URL strip. */
export type InstagramNoteSnapshot = {
  body: string;
};
