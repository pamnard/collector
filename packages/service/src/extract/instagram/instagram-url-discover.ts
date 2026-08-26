/**
 * Pure Instagram URL discovery for extract (#846).
 * No network — finds post/reel/tv URLs in note text and optional frontmatter.
 */

import { normalizeRemoteHttpUrl } from "@collector/core";

export type InstagramExtractCandidate = {
  extractorId: "instagram";
  /** Normalized https URL */
  url: string;
  shortcode: string;
};

const INSTAGRAM_HOSTS = new Set(["instagram.com", "m.instagram.com"]);

const MEDIA_PATH_KINDS = new Set(["p", "reel", "reels", "tv"]);

/** Instagram media shortcode alphabet in public URLs. */
const SHORTCODE_RE = /^[A-Za-z0-9_-]+$/;

/** http(s) URL tokens in note body (bare + inside markdown links). */
const HTTP_URL_RE = /https?:\/\/[^\s<>()\[\]"'`]+/gi;

const TRAILING_PUNCT_RE = /[.,;:!?)]+$/;

type ParsedInstagramMedia = {
  kind: string;
  shortcode: string;
};

function parseUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    return new URL(normalizeRemoteHttpUrl(trimmed));
  } catch {
    // Invalid URL string — expected for free-form note text.
    return null;
  }
}

function parseInstagramMedia(url: string): ParsedInstagramMedia | null {
  const parsed = parseUrl(url);
  if (!parsed) {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  if (!INSTAGRAM_HOSTS.has(host)) {
    return null;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const kindRaw = segments[0];
  const shortcode = segments[1];
  if (kindRaw === undefined || shortcode === undefined) {
    return null;
  }

  const kind = kindRaw.toLowerCase();
  if (!MEDIA_PATH_KINDS.has(kind) || !SHORTCODE_RE.test(shortcode)) {
    return null;
  }

  return { kind, shortcode };
}

/**
 * Shortcode from an Instagram post/reel/tv URL, or null when not a media URL.
 */
export function parseInstagramShortcode(url: string): string | null {
  return parseInstagramMedia(url)?.shortcode ?? null;
}

function candidateFromUrl(raw: string): InstagramExtractCandidate | null {
  const media = parseInstagramMedia(raw);
  if (!media) {
    return null;
  }
  return {
    extractorId: "instagram",
    url: `https://www.instagram.com/${media.kind}/${media.shortcode}/`,
    shortcode: media.shortcode,
  };
}

function collectHttpUrlsFromBody(body: string): string[] {
  const found: string[] = [];
  for (const match of body.matchAll(HTTP_URL_RE)) {
    const token = match[0].replace(TRAILING_PUNCT_RE, "");
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
    if (!candidate || byShortcode.has(candidate.shortcode)) {
      return;
    }
    byShortcode.set(candidate.shortcode, candidate);
  };

  consider(input.frontmatterUrl);
  for (const raw of collectHttpUrlsFromBody(input.body)) {
    consider(raw);
  }

  return [...byShortcode.values()];
}
