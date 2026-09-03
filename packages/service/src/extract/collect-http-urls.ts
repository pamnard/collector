/**
 * Collect bare / markdown-embedded http(s) URLs from free-form note body.
 */

import { normalizeRemoteHttpUrl } from "@collector/core";

/** http(s) URL tokens in note body (bare + inside markdown links). */
const HTTP_URL_RE = /https?:\/\/[^\s<>()\[\]"'`]+/gi;

const TRAILING_PUNCT_RE = /[.,;:!?)]+$/;

export function parseRemoteHttpUrl(raw: string): URL | null {
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

export function trimTrailingUrlPunctuation(raw: string): string {
  return raw.replace(TRAILING_PUNCT_RE, "");
}

export function collectHttpUrlsFromBody(body: string): string[] {
  const found: string[] = [];
  for (const match of body.matchAll(HTTP_URL_RE)) {
    const token = trimTrailingUrlPunctuation(match[0]);
    if (token.length > 0) {
      found.push(token);
    }
  }
  return found;
}
