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
 * Compute same-item merge: title, body (caption + optional accessibility,
 * Instagram URLs stripped, unrelated prior text preserved), canonical url,
 * and media intents.
 */
export function mergeInstagramIntoNote(
  note: InstagramNoteSnapshot,
  fetch: InstagramFetchSuccess,
): InstagramMergeResult {
  const title = deriveInstagramTitle(fetch);
  const instagramBlock = buildInstagramBodyBlock(fetch);
  const body = mergeBody(note.body, fetch.shortcode, instagramBlock);

  return {
    title,
    body,
    url: fetch.sourceUrl,
    mediaIntents: listInstagramMediaIntents(fetch),
  };
}

export function deriveInstagramTitle(fetch: InstagramFetchSuccess): string {
  const caption = fetch.caption;
  if (caption === null) {
    return `@${fetch.authorUsername}`;
  }
  const line = firstNonEmptyLine(caption);
  if (line === null) {
    return `@${fetch.authorUsername}`;
  }
  if (line.length <= INSTAGRAM_TITLE_MAX_LENGTH) {
    return line;
  }
  return line.slice(0, INSTAGRAM_TITLE_MAX_LENGTH);
}

function buildInstagramBodyBlock(fetch: InstagramFetchSuccess): string {
  const parts: string[] = [];
  if (fetch.caption !== null) {
    const caption = fetch.caption.trimEnd();
    if (caption.length > 0) {
      parts.push(caption);
    }
  }
  const accessibility = fetch.accessibilityCaption;
  if (accessibility !== null) {
    const text = accessibility.trim();
    if (text.length > 0) {
      parts.push(`${ACCESSIBILITY_HEADING}\n\n${text}`);
    }
  }
  return parts.join("\n\n");
}

/**
 * Strip Instagram URLs matching `shortcode` (bare + markdown links). First
 * removed span is replaced with `instagramBlock` when non-empty; remaining
 * matches are deleted. Unrelated body text is kept. When no URL match exists
 * and the block is non-empty, prepend the block (enrich).
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
    if (preserved.length === 0) {
      return normalizeBlankLines(instagramBlock);
    }
    return normalizeBlankLines(`${instagramBlock}\n\n${preserved}`);
  }

  let result = "";
  let cursor = 0;
  let inserted = false;
  for (const match of matches) {
    result += body.slice(cursor, match.start);
    if (!inserted && instagramBlock.length > 0) {
      result += instagramBlock;
      inserted = true;
    }
    cursor = match.end;
  }
  result += body.slice(cursor);
  return normalizeBlankLines(result);
}

type Span = { start: number; end: number };

function findInstagramUrlSpans(body: string, shortcode: string): Span[] {
  const spans: Span[] = [];
  const mdLinkRe = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi;
  for (const match of body.matchAll(mdLinkRe)) {
    const rawUrl = match[2];
    if (rawUrl === undefined || match.index === undefined) {
      continue;
    }
    if (!instagramUrlMatchesShortcode(rawUrl, shortcode)) {
      continue;
    }
    spans.push({ start: match.index, end: match.index + match[0].length });
  }

  const bareRe = /https?:\/\/[^\s<>\]`)]+/gi;
  for (const match of body.matchAll(bareRe)) {
    if (match.index === undefined) {
      continue;
    }
    const start = match.index;
    const end = start + match[0].length;
    if (spans.some((s) => start >= s.start && end <= s.end)) {
      continue;
    }
    const rawUrl = trimTrailingUrlPunctuation(match[0]);
    const consumed = rawUrl.length;
    if (!instagramUrlMatchesShortcode(rawUrl, shortcode)) {
      continue;
    }
    spans.push({ start, end: start + consumed });
  }

  spans.sort((a, b) => a.start - b.start);
  return dedupeOverlappingSpans(spans);
}

function dedupeOverlappingSpans(spans: Span[]): Span[] {
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

/**
 * True when `url` is an Instagram post/reel/tv URL for `shortcode`
 * (`instagram.com` / `www` / `m`).
 */
export function instagramUrlMatchesShortcode(
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
  if (segments.length < 2) {
    return false;
  }
  const kind = segments[0]!.toLowerCase();
  if (!INSTAGRAM_PATH_KINDS.has(kind)) {
    return false;
  }
  return segments[1] === shortcode;
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
  const ext = extensionForMedia(media);
  return `${shortcode}-${index + 1}${ext}`;
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
  const base = parsed.pathname.split("/").pop() ?? "";
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
