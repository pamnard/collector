/**
 * Parse Reddit post / redd.it / share URLs into a fetch target (#955).
 * Subreddit roots / users / wiki / search / CDN hosts are rejected.
 */

import {
  canonicalPostUrl,
  canonicalShareUrl,
  parseRedditTarget,
} from "./reddit-url-discover.js";

export type ParsedRedditFetchTarget =
  | {
      kind: "post";
      submissionId: string;
      subreddit: string | null;
      sourceUrl: string;
    }
  | {
      kind: "reddit_it";
      code: string;
      sourceUrl: string;
    }
  | {
      kind: "share";
      code: string;
      scope: "r" | "user" | "u";
      name: string;
      sourceUrl: string;
    };

export { canonicalPostUrl, canonicalShareUrl };

export function parseRedditFetchTarget(
  urlOrId: string,
): ParsedRedditFetchTarget | null {
  const raw = urlOrId.trim();
  if (!raw) {
    return null;
  }

  // Bare submission id (no scheme) — accepted for tests / MCP convenience.
  if (/^[A-Za-z0-9]+$/.test(raw) && !raw.includes(".")) {
    return {
      kind: "post",
      submissionId: raw,
      subreddit: null,
      sourceUrl: canonicalPostUrl(raw),
    };
  }

  const target = parseRedditTarget(raw);
  if (!target) {
    return null;
  }
  if (target.kind === "reddit_it") {
    return {
      kind: "reddit_it",
      code: target.code,
      sourceUrl: `https://redd.it/${target.code}`,
    };
  }
  if (target.kind === "share") {
    return {
      kind: "share",
      code: target.code,
      scope: target.scope,
      name: target.name,
      sourceUrl: canonicalShareUrl(target.scope, target.name, target.code),
    };
  }
  return {
    kind: "post",
    submissionId: target.submissionId,
    subreddit: target.subreddit,
    sourceUrl: canonicalPostUrl(target.submissionId, target.subreddit),
  };
}
