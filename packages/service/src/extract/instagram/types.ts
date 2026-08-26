/**
 * Shared Instagram fetch contract (#847 / #318).
 * Copy — do not invent a parallel shape.
 */

export type InstagramMediaKind = "image" | "video";

export type InstagramFetchedMedia = {
  kind: InstagramMediaKind;
  url: string; // CDN URL
  suggestedFilename?: string;
};

export type InstagramFetchSuccess = {
  sourceUrl: string;
  shortcode: string;
  authorUsername: string; // without leading @
  caption: string | null;
  /** Accessibility / alt text when Instagram provides it — not invented ASR. */
  accessibilityCaption: string | null;
  media: InstagramFetchedMedia[]; // all carousel items when present; non-empty on success
};

export type InstagramFetchErrorCode =
  | "login_wall"
  | "not_found"
  | "private_or_unavailable"
  | "rate_limited"
  | "no_media"
  | "invalid_url";

export type InstagramFetchResult =
  | { ok: true; value: InstagramFetchSuccess }
  | { ok: false; code: InstagramFetchErrorCode; message: string };

export type InstagramHttpFetch = typeof fetch;

export type FetchInstagramMediaOptions = {
  /** Injected HTTP — unit tests supply fixture-backed responses. */
  fetchImpl?: InstagramHttpFetch;
  /**
   * Optional session Cookie header (string) or name→value map.
   * Without cookies, only logged-out paths run.
   */
  cookies?: string | Readonly<Record<string, string>>;
};
