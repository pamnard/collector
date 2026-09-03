/**
 * Pure Instagram → same-note merge helpers (#848).
 * No HTTP, vault writes, or attachMediaFiles — assembly is #318.
 */

import {
  extensionFromUrl,
  firstNonEmptyLine,
  mergeBlockReplacingMatchedUrls,
} from "../merge-text.js";
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
    body: mergeBlockReplacingMatchedUrls(
      note.body,
      (url) => instagramUrlMatchesShortcode(url, fetch.shortcode),
      buildInstagramBodyBlock(fetch),
    ),
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
