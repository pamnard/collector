/**
 * Pure Instagram URL discovery for extract (#846).
 * No network — finds post/reel/tv URLs in note text and optional frontmatter.
 */

export type InstagramExtractCandidate = {
  extractorId: "instagram";
  /** Normalized https URL */
  url: string;
  shortcode: string;
};

const INSTAGRAM_HOSTS = new Set([
  "instagram.com",
  "www.instagram.com",
  "m.instagram.com",
]);

const MEDIA_PATH_KINDS = new Set(["p", "reel", "reels", "tv"]);

/** Instagram media shortcode: base64url-like alphabet used in public URLs. */
const SHORTCODE_RE = /^[A-Za-z0-9_-]+$/;

/** http(s) URL tokens in note body (bare + inside markdown links). */
const HTTP_URL_RE = /https?:\/\/[^\s<>()\[\]"'`]+/gi;

const TRAILING_PUNCT_RE = /[.,;:!?)]+$/;

function parseUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const withScheme = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
  try {
    return new URL(withScheme);
  } catch {
    // Invalid URL string — expected for free-form note text.
    return null;
  }
}

/**
 * Shortcode from an Instagram post/reel/tv URL, or null when not a media URL.
 */
export function parseInstagramShortcode(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!INSTAGRAM_HOSTS.has(host)) {
    return null;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    return null;
  }

  const kind = segments[0]!.toLowerCase();
  if (!MEDIA_PATH_KINDS.has(kind)) {
    return null;
  }

  const shortcode = segments[1]!;
  if (!SHORTCODE_RE.test(shortcode)) {
    return null;
  }

  return shortcode;
}

function normalizeInstagramMediaUrl(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!INSTAGRAM_HOSTS.has(host)) {
    return null;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    return null;
  }

  const kind = segments[0]!.toLowerCase();
  if (!MEDIA_PATH_KINDS.has(kind)) {
    return null;
  }

  const shortcode = segments[1]!;
  if (!SHORTCODE_RE.test(shortcode)) {
    return null;
  }

  return `https://www.instagram.com/${kind}/${shortcode}/`;
}

function candidateFromUrl(raw: string): InstagramExtractCandidate | null {
  const shortcode = parseInstagramShortcode(raw);
  if (!shortcode) {
    return null;
  }
  const url = normalizeInstagramMediaUrl(raw);
  if (!url) {
    return null;
  }
  return { extractorId: "instagram", url, shortcode };
}

function collectHttpUrlsFromBody(body: string): string[] {
  const found: string[] = [];
  HTTP_URL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HTTP_URL_RE.exec(body)) !== null) {
    const token = match[0]!.replace(TRAILING_PUNCT_RE, "");
    if (token.length > 0) {
      found.push(token);
    }
  }
  return found;
}

/**
 * Discover Instagram extract candidates from note body and optional frontmatter `url`.
 * Dedupes by shortcode (first occurrence wins).
 */
export function discoverInstagramCandidates(input: {
  body: string;
  frontmatterUrl?: string | null;
}): InstagramExtractCandidate[] {
  const byShortcode = new Map<string, InstagramExtractCandidate>();

  const consider = (raw: string | null | undefined) => {
    if (raw == null || raw.trim().length === 0) {
      return;
    }
    const candidate = candidateFromUrl(raw);
    if (!candidate) {
      return;
    }
    if (!byShortcode.has(candidate.shortcode)) {
      byShortcode.set(candidate.shortcode, candidate);
    }
  };

  consider(input.frontmatterUrl);
  for (const raw of collectHttpUrlsFromBody(input.body)) {
    consider(raw);
  }

  return [...byShortcode.values()];
}
