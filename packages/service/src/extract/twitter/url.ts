/**
 * Parse Twitter/X URLs into a fetch target (#954).
 */

import { parseTwitterTarget, type ParsedTwitterTarget } from "./twitter-url-discover.js";

export type ParsedTwitterFetchTarget =
  | {
      kind: "status";
      statusId: string;
      username: string | null;
      sourceUrl: string;
    }
  | {
      kind: "article";
      articleId: string;
      username: string | null;
      sourceUrl: string;
    }
  | {
      kind: "tco";
      code: string;
      sourceUrl: string;
    };

export function canonicalStatusUrl(
  statusId: string,
  username?: string | null,
): string {
  const user = username && username.length > 0 ? username : "i";
  return `https://x.com/${user}/status/${statusId}`;
}

export function canonicalArticleUrl(
  articleId: string,
  username?: string | null,
): string {
  const user = username && username.length > 0 ? username : "i";
  return `https://x.com/${user}/article/${articleId}`;
}

export function parseTwitterFetchTarget(
  urlOrId: string,
): ParsedTwitterFetchTarget | null {
  const raw = urlOrId.trim();
  if (!raw) {
    return null;
  }

  if (/^\d+$/.test(raw)) {
    return {
      kind: "status",
      statusId: raw,
      username: null,
      sourceUrl: canonicalStatusUrl(raw),
    };
  }

  if (raw.startsWith("article:") && raw.length > "article:".length) {
    const articleId = raw.slice("article:".length);
    return {
      kind: "article",
      articleId,
      username: null,
      sourceUrl: canonicalArticleUrl(articleId),
    };
  }

  const media: ParsedTwitterTarget | null = parseTwitterTarget(raw);
  if (!media) {
    return null;
  }
  if (media.kind === "tco") {
    return {
      kind: "tco",
      code: media.code,
      sourceUrl: `https://t.co/${media.code}`,
    };
  }
  if (media.kind === "article") {
    return {
      kind: "article",
      articleId: media.articleId,
      username: media.username,
      sourceUrl: canonicalArticleUrl(media.articleId, media.username),
    };
  }
  return {
    kind: "status",
    statusId: media.statusId,
    username: media.username,
    sourceUrl: canonicalStatusUrl(media.statusId, media.username),
  };
}
