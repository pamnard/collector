/**
 * Shared note-merge text helpers for site extractors.
 * Site-specific URL matching stays in each extractor.
 */

import { trimTrailingUrlPunctuation } from "./collect-http-urls.js";

export type TextSpan = { start: number; end: number };

export function firstNonEmptyLine(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}

export function normalizeBlankLines(text: string): string {
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function extensionFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const base = parsed.pathname.split("/").pop();
  if (base === undefined || base.length === 0) {
    return null;
  }
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) {
    return null;
  }
  const ext = base.slice(dot).toLowerCase();
  if (!/^\.[a-z0-9]{1,8}$/.test(ext)) {
    return null;
  }
  return ext;
}

/**
 * Find markdown-link and bare http(s) spans whose URL matches `urlMatches`.
 * Overlapping bare URLs inside markdown links are skipped.
 */
export function findMatchingHttpUrlSpans(
  body: string,
  urlMatches: (url: string) => boolean,
): TextSpan[] {
  const spans: TextSpan[] = [];

  for (const match of body.matchAll(
    /\[(?:[^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi,
  )) {
    const rawUrl = match[1];
    if (rawUrl === undefined || match.index === undefined) {
      continue;
    }
    if (!urlMatches(rawUrl)) {
      continue;
    }
    spans.push({ start: match.index, end: match.index + match[0].length });
  }

  for (const match of body.matchAll(/https?:\/\/[^\s<>\]`)]+/gi)) {
    if (match.index === undefined) {
      continue;
    }
    const start = match.index;
    const end = start + match[0].length;
    if (spans.some((s) => start >= s.start && end <= s.end)) {
      continue;
    }
    const rawUrl = trimTrailingUrlPunctuation(match[0]);
    if (!urlMatches(rawUrl)) {
      continue;
    }
    spans.push({ start, end: start + rawUrl.length });
  }

  spans.sort((a, b) => a.start - b.start);
  const out: TextSpan[] = [];
  for (const span of spans) {
    const prev = out[out.length - 1];
    if (prev && span.start < prev.end) {
      continue;
    }
    out.push(span);
  }
  return out;
}

/**
 * Replace the first matching URL span with `block` (when non-empty); delete
 * remaining matches. Preserve unrelated text. If no URL match, prepend the
 * block when present.
 */
export function mergeBlockReplacingMatchedUrls(
  body: string,
  urlMatches: (url: string) => boolean,
  block: string,
): string {
  const matches = findMatchingHttpUrlSpans(body, urlMatches);
  if (matches.length === 0) {
    if (block.length === 0) {
      return normalizeBlankLines(body);
    }
    const preserved = body.trim();
    return normalizeBlankLines(
      preserved.length === 0 ? block : `${block}\n\n${preserved}`,
    );
  }

  const chunks: string[] = [];
  let cursor = 0;
  let inserted = false;
  for (const match of matches) {
    chunks.push(body.slice(cursor, match.start));
    if (!inserted && block.length > 0) {
      chunks.push(block);
      inserted = true;
    }
    cursor = match.end;
  }
  chunks.push(body.slice(cursor));
  return normalizeBlankLines(chunks.join(""));
}
