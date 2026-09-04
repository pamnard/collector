/**
 * Shared Reddit extract contracts (#955).
 */

export type RedditMediaKind = "image" | "video";

export type RedditFetchedMedia = {
  kind: RedditMediaKind;
  /** CDN URL (i.redd.it / v.redd.it / preview.redd.it / …) */
  url: string;
};

/** Successful fetch payload — input to same-item merge. */
export type RedditFetchSuccess = {
  sourceUrl: string;
  /** Submission id without `t3_` prefix (e.g. `abc123`). */
  submissionId: string;
  /** Without leading `u/`. */
  authorUsername: string | null;
  title: string | null;
  /** Post body (selftext); may be empty for link/image-only posts. */
  selftext: string | null;
  media: RedditFetchedMedia[];
};

export type RedditFetchErrorCode =
  | "cookies_unavailable"
  | "login_wall"
  | "not_found"
  | "private_or_unavailable"
  | "rate_limited"
  | "no_media"
  | "invalid_url";

export type RedditFetchResult =
  | { ok: true; value: RedditFetchSuccess }
  | { ok: false; code: RedditFetchErrorCode; message: string };

export type RedditHttpFetch = typeof fetch;

export type FetchRedditPostOptions = {
  /** Injected HTTP — unit tests supply fixture-backed responses. */
  fetchImpl?: RedditHttpFetch;
  /**
   * Injected Cookie header — offline tests skip browser/yt-dlp.
   * Production leaves this unset so fetch loads cookies from the browser.
   */
  cookieHeader?: string;
  /** Override cookies-from-browser profile (tests / debug). */
  cookiesBrowser?: string | null;
  /** Override cookie loader (tests). */
  loadCookieHeaderImpl?: () => Promise<
    | { ok: true; cookieHeader: string }
    | { ok: false; code: "cookies_unavailable"; message: string }
  >;
};

export type RedditMediaIntent = {
  kind: RedditMediaKind;
  sourceUrl: string;
  filename: string;
};

export type RedditMergeResult = {
  title: string;
  body: string;
  url: string;
  mediaIntents: RedditMediaIntent[];
};

export type RedditNoteSnapshot = {
  body: string;
};
