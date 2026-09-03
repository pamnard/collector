/**
 * Pure Pinterest → same-note merge helpers (#34).
 * No HTTP, vault writes, or attachMediaFiles — assembly is the plugin.
 */

import {
  extensionFromUrl,
  firstNonEmptyLine,
  mergeBlockReplacingMatchedUrls,
} from "../merge-text.js";
import { parsePinterestShortcode } from "./pinterest-url-discover.js";
import type {
  PinterestFetchSuccess,
  PinterestFetchedMedia,
  PinterestMediaIntent,
  PinterestMergeResult,
  PinterestNoteSnapshot,
} from "./types.js";

/** Matches item title schema max (`packages/shared` title ≤500). */
export const PINTEREST_TITLE_MAX_LENGTH = 500;

/**
 * Media attachment intents for later download + attachMediaFiles.
 */
export function listPinterestMediaIntents(
  fetch: PinterestFetchSuccess,
): PinterestMediaIntent[] {
  return fetch.media.map((media, index) => ({
    kind: media.kind,
    sourceUrl: media.url,
    filename: mediaFilename(fetch.pinId, index, media),
  }));
}

/**
 * Same-item merge: title, body (description, Pinterest URLs stripped,
 * unrelated prior text preserved), canonical url, media intents.
 */
export function mergePinterestIntoNote(
  note: PinterestNoteSnapshot,
  fetch: PinterestFetchSuccess,
  options?: { bodyUrlKeys?: string[] },
): PinterestMergeResult {
  const bodyKeys = options?.bodyUrlKeys ?? [fetch.pinId];
  return {
    title: derivePinterestTitle(fetch),
    body: mergeBlockReplacingMatchedUrls(
      note.body,
      (url) => pinterestUrlMatchesKeys(url, bodyKeys),
      buildPinterestBodyBlock(fetch),
    ),
    url: fetch.sourceUrl,
    mediaIntents: listPinterestMediaIntents(fetch),
  };
}

export function derivePinterestTitle(fetch: PinterestFetchSuccess): string {
  const fromTitle =
    fetch.title === null ? null : firstNonEmptyLine(fetch.title);
  if (fromTitle !== null) {
    return truncateTitle(fromTitle);
  }
  const fromDescription =
    fetch.description === null ? null : firstNonEmptyLine(fetch.description);
  if (fromDescription !== null) {
    return truncateTitle(fromDescription);
  }
  if (fetch.authorUsername) {
    return `@${fetch.authorUsername}`;
  }
  return "Pinterest pin";
}

function truncateTitle(line: string): string {
  return line.length <= PINTEREST_TITLE_MAX_LENGTH
    ? line
    : line.slice(0, PINTEREST_TITLE_MAX_LENGTH);
}

function buildPinterestBodyBlock(fetch: PinterestFetchSuccess): string {
  if (fetch.description !== null && firstNonEmptyLine(fetch.description) !== null) {
    return fetch.description.trimEnd();
  }
  if (fetch.title !== null && firstNonEmptyLine(fetch.title) !== null) {
    return fetch.title.trimEnd();
  }
  return "";
}

function pinterestUrlMatchesKeys(url: string, urlKeys: string[]): boolean {
  const shortcode = parsePinterestShortcode(url);
  return shortcode !== null && urlKeys.includes(shortcode);
}

function mediaFilename(
  pinId: string,
  index: number,
  media: PinterestFetchedMedia,
): string {
  return `${pinId}-${index + 1}${extensionForMedia(media)}`;
}

function extensionForMedia(media: PinterestFetchedMedia): string {
  const fromUrl = extensionFromUrl(media.url);
  if (fromUrl !== null) {
    return fromUrl;
  }
  return media.kind === "video" ? ".mp4" : ".jpg";
}
