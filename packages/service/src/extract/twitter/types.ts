/**
 * Shared Twitter/X extract contracts (#954).
 */

export type TwitterContentKind = "status" | "article";

export type TwitterMediaKind = "image" | "video";

export type TwitterFetchedMedia = {
  kind: TwitterMediaKind;
  /** CDN URL */
  url: string;
};

/** Successful fetch payload — input to same-item merge. */
export type TwitterFetchSuccess = {
  kind: TwitterContentKind;
  sourceUrl: string;
  /** Status snowflake, or article id (without `article:` prefix). */
  contentId: string;
  /** Without leading `@`. */
  authorUsername: string | null;
  title: string | null;
  /** Full text for status or article body. */
  text: string | null;
  media: TwitterFetchedMedia[];
};

export type TwitterFetchErrorCode =
  | "login_wall"
  | "not_found"
  | "private_or_unavailable"
  | "rate_limited"
  | "invalid_url";

export type TwitterFetchResult =
  | { ok: true; value: TwitterFetchSuccess }
  | { ok: false; code: TwitterFetchErrorCode; message: string };

export type TwitterHttpFetch = typeof fetch;

export type FetchTwitterContentOptions = {
  /** Injected HTTP — unit tests supply fixture-backed responses. */
  fetchImpl?: TwitterHttpFetch;
};

export type TwitterMediaIntent = {
  kind: TwitterMediaKind;
  sourceUrl: string;
  filename: string;
};

export type TwitterMergeResult = {
  title: string;
  body: string;
  url: string;
  mediaIntents: TwitterMediaIntent[];
};

export type TwitterNoteSnapshot = {
  body: string;
};
