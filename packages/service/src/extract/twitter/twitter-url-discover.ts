/**
 * Pure Twitter/X URL discovery for extract (#954).
 * No network — finds status / article / t.co URLs in note body only.
 */

import {
  collectHttpUrlsFromBody,
  parseRemoteHttpUrl,
} from "../collect-http-urls.js";

export type TwitterExtractCandidate = {
  extractorId: "twitter";
  /** Normalized https URL */
  url: string;
  /**
   * Opaque extract_auto key (stored as ExtractCandidate.meta.shortcode):
   * status snowflake, `article:{id}`, or `tco:{code}`.
   */
  shortcode: string;
};

const TWITTER_HOSTS = new Set([
  "x.com",
  "twitter.com",
  "mobile.twitter.com",
]);
const TCO_HOSTS = new Set(["t.co"]);

const STATUS_ID_RE = /^\d+$/;
const ARTICLE_ID_RE = /^[A-Za-z0-9_-]+$/;
const TCO_CODE_RE = /^[A-Za-z0-9_-]+$/;

export type ParsedTwitterTarget =
  | { kind: "status"; statusId: string; username: string | null }
  | { kind: "article"; articleId: string; username: string | null }
  | { kind: "tco"; code: string };

function normalizeHost(hostname: string): string {
  return hostname.replace(/^www\./, "").toLowerCase();
}

function isTwitterHost(hostname: string): boolean {
  return TWITTER_HOSTS.has(normalizeHost(hostname));
}

/**
 * Parse a Twitter/X status, article, or t.co URL.
 */
export function parseTwitterTarget(url: string): ParsedTwitterTarget | null {
  const parsed = parseRemoteHttpUrl(url);
  if (!parsed) {
    return null;
  }

  const host = normalizeHost(parsed.hostname);

  if (TCO_HOSTS.has(host)) {
    const code = parsed.pathname.split("/").filter(Boolean)[0];
    if (code === undefined || !TCO_CODE_RE.test(code)) {
      return null;
    }
    return { kind: "tco", code };
  }

  if (!isTwitterHost(host)) {
    return null;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    return null;
  }

  // /i/status/{id} or /{user}/status/{id}[/photo/N]
  const statusIdx = segments.findIndex((s) => s.toLowerCase() === "status");
  if (statusIdx >= 0 && segments[statusIdx + 1] !== undefined) {
    const statusId = segments[statusIdx + 1]!;
    if (!STATUS_ID_RE.test(statusId)) {
      return null;
    }
    const username =
      statusIdx > 0 && segments[statusIdx - 1]!.toLowerCase() !== "i"
        ? segments[statusIdx - 1]!
        : null;
    return { kind: "status", statusId, username };
  }

  // /{user}/article/{id}
  const articleIdx = segments.findIndex((s) => s.toLowerCase() === "article");
  if (articleIdx >= 1 && segments[articleIdx + 1] !== undefined) {
    const articleId = segments[articleIdx + 1]!;
    if (!ARTICLE_ID_RE.test(articleId)) {
      return null;
    }
    return {
      kind: "article",
      articleId,
      username: segments[articleIdx - 1]!,
    };
  }

  return null;
}

/**
 * Stable extract key from a Twitter/X URL, or null when not supported.
 */
export function parseTwitterShortcode(url: string): string | null {
  const target = parseTwitterTarget(url);
  if (!target) {
    return null;
  }
  if (target.kind === "status") {
    return target.statusId;
  }
  if (target.kind === "article") {
    return `article:${target.articleId}`;
  }
  return `tco:${target.code}`;
}

function candidateFromUrl(raw: string): TwitterExtractCandidate | null {
  const target = parseTwitterTarget(raw);
  if (!target) {
    return null;
  }
  if (target.kind === "tco") {
    return {
      extractorId: "twitter",
      url: `https://t.co/${target.code}`,
      shortcode: `tco:${target.code}`,
    };
  }
  if (target.kind === "article") {
    const user = target.username ?? "i";
    return {
      extractorId: "twitter",
      url: `https://x.com/${user}/article/${target.articleId}`,
      shortcode: `article:${target.articleId}`,
    };
  }
  const user = target.username ?? "i";
  return {
    extractorId: "twitter",
    url: `https://x.com/${user}/status/${target.statusId}`,
    shortcode: target.statusId,
  };
}

/**
 * Discover Twitter/X extract candidates from note body only.
 * Frontmatter `url` is the stored canonical link after import — not a pending
 * import signal (#954). Dedupes by shortcode (first occurrence wins).
 */
export function discoverTwitterCandidates(input: {
  body: string;
  /** Ignored for candidates — kept for call-site compatibility. */
  frontmatterUrl?: string | null;
}): TwitterExtractCandidate[] {
  const byShortcode = new Map<string, TwitterExtractCandidate>();

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

  for (const raw of collectHttpUrlsFromBody(input.body)) {
    consider(raw);
  }

  return [...byShortcode.values()];
}
