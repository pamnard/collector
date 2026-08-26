/**
 * Pure Instagram → same-note merge helpers (#848).
 * No HTTP, vault writes, or attachMediaFiles — assembly is #318.
 */

import type {
  InstagramFetchSuccess,
  InstagramFetchedMedia,
  InstagramMediaIntent,
  InstagramMergeResult,
  InstagramNoteSnapshot,
} from "./types.js";

/** Matches item title schema max (`packages/shared` title ≤500). */
export const INSTAGRAM_TITLE_MAX_LENGTH = 500;

const INSTAGRAM_PATH_KINDS = new Set(["p", "reel", "reels", "tv"]);

const ACCESSIBILITY_HEADING = "## Accessibility";

/**
 * Media attachment intents for later download + attachMediaFiles (#318).
 * Filenames are stable: `suggestedFilename` when present, otherwise
 * `{shortcode}-{1-basedIndex}.{ext}` derived from CDN path or media kind.
 */
export function listInstagramMediaIntents(
  fetch: InstagramFetchSuccess,
): InstagramMediaIntent[] {
  return fetch.media.map((media, index) => ({
    kind: media.kind,
    sourceUrl: media.url,
    filename: mediaFilename(fetch.shortcode, index, media),
  }));
}

/**
 * Same-item merge: title, body (caption + optional accessibility, Instagram
 * URLs stripped, unrelated prior text preserved), canonical url, media intents.
 */
export function mergeInstagramIntoNote(
  note: InstagramNoteSnapshot,
  fetch: InstagramFetchSuccess,
): InstagramMergeResult {
  return {
    title: deriveInstagramTitle(fetch),
    body: mergeBody(note.body, fetch.shortcode, buildInstagramBodyBlock(fetch)),
    url: fetch.sourceUrl,
    mediaIntents: listInstagramMediaIntents(fetch),
  };
}

export function deriveInstagramTitle(fetch: InstagramFetchSuccess): string {
  const line =
    fetch.caption === null ? null : firstNonEmptyLine(fetch.caption);
  if (line === null) {
    return `@${fetch.authorUsername}`;
  }
  return line.length <= INSTAGRAM_TITLE_MAX_LENGTH
    ? line
    : line.slice(0, INSTAGRAM_TITLE_MAX_LENGTH);
}

function buildInstagramBodyBlock(fetch: InstagramFetchSuccess): string {
  const parts: string[] = [];
  if (fetch.caption !== null && firstNonEmptyLine(fetch.caption) !== null) {
    parts.push(fetch.caption.trimEnd());
  }
  if (fetch.accessibilityCaption !== null) {
    const text = fetch.accessibilityCaption.trim();
    if (text.length > 0) {
      parts.push(`${ACCESSIBILITY_HEADING}\n\n${text}`);
    }
  }
  return parts.join("\n\n");
}

/**
 * Replace the first Instagram URL matching `shortcode` with `instagramBlock`
 * (when non-empty); delete remaining matches. Preserve unrelated text. If no
 * URL match, prepend the block when present.
 */
function mergeBody(
  body: string,
  shortcode: string,
  instagramBlock: string,
): string {
  const matches = findInstagramUrlSpans(body, shortcode);
  if (matches.length === 0) {
    if (instagramBlock.length === 0) {
      return normalizeBlankLines(body);
    }
    const preserved = body.trim();
    return normalizeBlankLines(
      preserved.length === 0
        ? instagramBlock
        : `${instagramBlock}\n\n${preserved}`,
    );
  }

  const chunks: string[] = [];
  let cursor = 0;
  let inserted = false;
  for (const match of matches) {
    chunks.push(body.slice(cursor, match.start));
    if (!inserted && instagramBlock.length > 0) {
      chunks.push(instagramBlock);
      inserted = true;
    }
    cursor = match.end;
  }
  chunks.push(body.slice(cursor));
  return normalizeBlankLines(chunks.join(""));
}

type Span = { start: number; end: number };

function findInstagramUrlSpans(body: string, shortcode: string): Span[] {
  const spans: Span[] = [];

  for (const match of body.matchAll(
    /\[(?:[^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi,
  )) {
    const rawUrl = match[1];
    if (rawUrl === undefined || match.index === undefined) {
      continue;
    }
    if (!instagramUrlMatchesShortcode(rawUrl, shortcode)) {
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
    if (!instagramUrlMatchesShortcode(rawUrl, shortcode)) {
      continue;
    }
    spans.push({ start, end: start + rawUrl.length });
  }

  spans.sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const span of spans) {
    const prev = out[out.length - 1];
    if (prev && span.start < prev.end) {
      continue;
    }
    out.push(span);
  }
  return out;
}

function instagramUrlMatchesShortcode(
  url: string,
  shortcode: string,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  if (host !== "instagram.com" && host !== "m.instagram.com") {
    return false;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  const kind = segments[0];
  const code = segments[1];
  if (kind === undefined || code === undefined) {
    return false;
  }
  if (!INSTAGRAM_PATH_KINDS.has(kind.toLowerCase())) {
    return false;
  }
  return code === shortcode;
}

function mediaFilename(
  shortcode: string,
  index: number,
  media: InstagramFetchedMedia,
): string {
  if (media.suggestedFilename !== undefined) {
    const name = media.suggestedFilename.trim();
    if (name.length === 0) {
      throw new Error(
        "Instagram media suggestedFilename must be non-empty when provided",
      );
    }
    return name;
  }
  return `${shortcode}-${index + 1}${extensionForMedia(media)}`;
}

function extensionForMedia(media: InstagramFetchedMedia): string {
  const fromUrl = extensionFromUrl(media.url);
  if (fromUrl !== null) {
    return fromUrl;
  }
  return media.kind === "video" ? ".mp4" : ".jpg";
}

function extensionFromUrl(url: string): string | null {
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

function firstNonEmptyLine(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}

function trimTrailingUrlPunctuation(raw: string): string {
  return raw.replace(/[.,;:!?)]+$/, "");
}

function normalizeBlankLines(text: string): string {
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
