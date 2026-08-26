/**
 * Parse Instagram post/reel/tv URLs or bare shortcodes into a shortcode.
 * Stories / profile-only URLs are rejected (#846 path set, fetch-side only).
 */

const SHORTCODE_RE = /^[A-Za-z0-9_-]+$/;
const PATH_RE =
  /^\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/i;

const INSTAGRAM_HOSTS = new Set([
  "instagram.com",
  "www.instagram.com",
  "m.instagram.com",
]);

export type ParsedInstagramTarget = {
  shortcode: string;
  /** Canonical https URL preferring the path form from the input when present. */
  sourceUrl: string;
};

export function parseInstagramTarget(
  urlOrShortcode: string,
): ParsedInstagramTarget | null {
  const raw = urlOrShortcode.trim();
  if (!raw) {
    return null;
  }

  if (SHORTCODE_RE.test(raw) && !raw.includes(".") && !raw.includes("/")) {
    return {
      shortcode: raw,
      sourceUrl: `https://www.instagram.com/p/${raw}/`,
    };
  }

  if (!URL.canParse(raw)) {
    return null;
  }
  const parsed = new URL(raw);

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!INSTAGRAM_HOSTS.has(host)) {
    return null;
  }

  const match = PATH_RE.exec(parsed.pathname);
  if (!match) {
    return null;
  }

  const shortcode = match[1];
  if (!shortcode || !SHORTCODE_RE.test(shortcode)) {
    return null;
  }

  const kind = parsed.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
  const pathKind =
    kind === "reel" || kind === "reels"
      ? "reel"
      : kind === "tv"
        ? "tv"
        : "p";

  return {
    shortcode,
    sourceUrl: `https://www.instagram.com/${pathKind}/${shortcode}/`,
  };
}
