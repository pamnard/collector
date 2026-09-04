/**
 * Pure Reddit URL discovery for extract (#955).
 * No network — finds post / redd.it / share URLs in note body only.
 */

import {
  collectHttpUrlsFromBody,
  parseRemoteHttpUrl,
} from "../collect-http-urls.js";

export type RedditExtractCandidate = {
  extractorId: "reddit";
  /** Normalized https URL */
  url: string;
  /**
   * Opaque extract_auto key (stored as ExtractCandidate.meta.shortcode):
   * submission id, `reddit:{code}` for redd.it, or `share:{code}` for /s/ links.
   */
  shortcode: string;
};

const REDDIT_HOSTS = new Set([
  "reddit.com",
  "old.reddit.com",
  "new.reddit.com",
  "np.reddit.com",
  "www.reddit.com",
]);
const REDDIT_IT_HOSTS = new Set(["redd.it"]);

/** Base36-ish codes Reddit uses for submissions / short links. */
const REDDIT_CODE_RE = /^[A-Za-z0-9]+$/;
const SHARE_CODE_RE = /^[A-Za-z0-9_-]+$/;

export type ParsedRedditTarget =
  | { kind: "post"; submissionId: string; subreddit: string | null }
  | { kind: "reddit_it"; code: string }
  | {
      kind: "share";
      code: string;
      /** `r` + subreddit, or `user`/`u` + username */
      scope: "r" | "user" | "u";
      name: string;
    };

function normalizeHost(hostname: string): string {
  return hostname.replace(/^www\./, "").toLowerCase();
}

function isRedditHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (REDDIT_HOSTS.has(host)) {
    return true;
  }
  const bare = normalizeHost(hostname);
  return (
    bare === "reddit.com" ||
    bare === "old.reddit.com" ||
    bare === "new.reddit.com" ||
    bare === "np.reddit.com" ||
    bare.endsWith(".reddit.com")
  );
}

/**
 * Parse a Reddit post, redd.it, or mobile share URL.
 */
export function parseRedditTarget(url: string): ParsedRedditTarget | null {
  const parsed = parseRemoteHttpUrl(url);
  if (!parsed) {
    return null;
  }

  const host = normalizeHost(parsed.hostname);

  if (REDDIT_IT_HOSTS.has(host)) {
    const code = parsed.pathname.split("/").filter(Boolean)[0];
    if (code === undefined || !REDDIT_CODE_RE.test(code)) {
      return null;
    }
    return { kind: "reddit_it", code };
  }

  if (!isRedditHost(parsed.hostname)) {
    return null;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  // /r/{sub}/s/{code} — mobile share (opaque token, not submission id)
  // Path: r, sub, s, code → length >= 4
  if (
    segments.length >= 4 &&
    segments[0]!.toLowerCase() === "r" &&
    segments[2]!.toLowerCase() === "s"
  ) {
    const code = segments[3]!;
    if (!SHARE_CODE_RE.test(code)) {
      return null;
    }
    return {
      kind: "share",
      code,
      scope: "r",
      name: segments[1]!,
    };
  }

  // /user/{name}/s/{code} or /u/{name}/s/{code}
  if (
    segments.length >= 4 &&
    (segments[0]!.toLowerCase() === "user" ||
      segments[0]!.toLowerCase() === "u") &&
    segments[2]!.toLowerCase() === "s"
  ) {
    const code = segments[3]!;
    if (!SHARE_CODE_RE.test(code)) {
      return null;
    }
    return {
      kind: "share",
      code,
      scope: segments[0]!.toLowerCase() === "u" ? "u" : "user",
      name: segments[1]!,
    };
  }

  // /r/{sub}/comments/{id}/… or /comments/{id}/…
  const commentsIdx = segments.findIndex(
    (s) => s.toLowerCase() === "comments",
  );
  if (commentsIdx < 0 || segments[commentsIdx + 1] === undefined) {
    return null;
  }

  const submissionId = segments[commentsIdx + 1]!;
  if (!REDDIT_CODE_RE.test(submissionId)) {
    return null;
  }

  let subreddit: string | null = null;
  if (
    commentsIdx >= 2 &&
    segments[commentsIdx - 2]!.toLowerCase() === "r"
  ) {
    subreddit = segments[commentsIdx - 1]!;
  }

  return { kind: "post", submissionId, subreddit };
}

/**
 * Stable extract key from a Reddit post / short / share URL, or null when unsupported.
 */
export function parseRedditShortcode(url: string): string | null {
  const target = parseRedditTarget(url);
  if (!target) {
    return null;
  }
  if (target.kind === "post") {
    return target.submissionId;
  }
  if (target.kind === "reddit_it") {
    return `reddit:${target.code}`;
  }
  return `share:${target.code}`;
}

export function canonicalPostUrl(
  submissionId: string,
  subreddit?: string | null,
): string {
  if (subreddit) {
    return `https://www.reddit.com/r/${subreddit}/comments/${submissionId}/`;
  }
  return `https://www.reddit.com/comments/${submissionId}/`;
}

export function canonicalShareUrl(
  scope: "r" | "user" | "u",
  name: string,
  code: string,
): string {
  if (scope === "r") {
    return `https://www.reddit.com/r/${name}/s/${code}`;
  }
  if (scope === "u") {
    return `https://www.reddit.com/u/${name}/s/${code}`;
  }
  return `https://www.reddit.com/user/${name}/s/${code}`;
}

function candidateFromUrl(raw: string): RedditExtractCandidate | null {
  const target = parseRedditTarget(raw);
  if (!target) {
    return null;
  }
  if (target.kind === "reddit_it") {
    return {
      extractorId: "reddit",
      url: `https://redd.it/${target.code}`,
      shortcode: `reddit:${target.code}`,
    };
  }
  if (target.kind === "share") {
    return {
      extractorId: "reddit",
      url: canonicalShareUrl(target.scope, target.name, target.code),
      shortcode: `share:${target.code}`,
    };
  }
  return {
    extractorId: "reddit",
    url: canonicalPostUrl(target.submissionId, target.subreddit),
    shortcode: target.submissionId,
  };
}

/**
 * Discover Reddit extract candidates from note body only.
 * Frontmatter `url` is the stored canonical link after import — not a pending
 * import signal (#955). Dedupes by shortcode (first occurrence wins).
 */
export function discoverRedditCandidates(input: {
  body: string;
  /** Ignored for candidates — kept for call-site compatibility. */
  frontmatterUrl?: string | null;
}): RedditExtractCandidate[] {
  const byShortcode = new Map<string, RedditExtractCandidate>();

  const consider = (raw: string | null | undefined) => {
    if (raw == null || raw.trim().length === 0) {
      return;
    }
    const candidate = candidateFromUrl(raw);
    if (!candidate || byShortcode.has(candidate.shortcode)) {
      return;
    }
    // redd.it/{id} and /comments/{id} are the same submission before resolve.
    if (candidate.shortcode.startsWith("reddit:")) {
      const bare = candidate.shortcode.slice("reddit:".length);
      if (byShortcode.has(bare)) {
        return;
      }
    } else if (byShortcode.has(`reddit:${candidate.shortcode}`)) {
      return;
    }
    byShortcode.set(candidate.shortcode, candidate);
  };

  for (const raw of collectHttpUrlsFromBody(input.body)) {
    consider(raw);
  }

  return [...byShortcode.values()];
}
