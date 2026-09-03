/**
 * Shared Pinterest extract contracts (#34).
 */

export type PinterestMediaKind = "image" | "video";

export type PinterestFetchedMedia = {
  kind: PinterestMediaKind;
  /** CDN URL */
  url: string;
};

/** Successful fetch payload — input to same-item merge. */
export type PinterestFetchSuccess = {
  sourceUrl: string;
  pinId: string;
  /** Without leading `@`. */
  authorUsername: string | null;
  title: string | null;
  description: string | null;
  /** All media items when present; non-empty on success. */
  media: PinterestFetchedMedia[];
};

export type PinterestFetchErrorCode =
  | "login_wall"
  | "not_found"
  | "private_or_unavailable"
  | "rate_limited"
  | "no_media"
  | "invalid_url";

export type PinterestFetchResult =
  | { ok: true; value: PinterestFetchSuccess }
  | { ok: false; code: PinterestFetchErrorCode; message: string };

export type PinterestHttpFetch = typeof fetch;

export type FetchPinterestPinOptions = {
  /** Injected HTTP — unit tests supply fixture-backed responses. */
  fetchImpl?: PinterestHttpFetch;
};

export type PinterestMediaIntent = {
  kind: PinterestMediaKind;
  sourceUrl: string;
  filename: string;
};

export type PinterestMergeResult = {
  title: string;
  body: string;
  url: string;
  mediaIntents: PinterestMediaIntent[];
};

export type PinterestNoteSnapshot = {
  body: string;
};
