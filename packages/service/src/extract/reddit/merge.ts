/**
 * Pure Reddit → same-note merge helpers (#955).
 * No HTTP, vault writes, or attachMediaFiles — assembly is the plugin.
 */

import {
  extensionFromUrl,
  firstNonEmptyLine,
  mergeBlockReplacingMatchedUrls,
} from "../merge-text.js";
import { parseRedditShortcode } from "./reddit-url-discover.js";
import type {
  RedditFetchSuccess,
  RedditFetchedMedia,
  RedditMediaIntent,
  RedditMergeResult,
  RedditNoteSnapshot,
} from "./types.js";

/** Matches item title schema max (`packages/shared` title ≤500). */
export const REDDIT_TITLE_MAX_LENGTH = 500;

/**
 * Media attachment intents for later download + attachMediaFiles.
 */
export function listRedditMediaIntents(
  fetch: RedditFetchSuccess,
): RedditMediaIntent[] {
  return fetch.media.map((media, index) => ({
    kind: media.kind,
    sourceUrl: media.url,
    filename: mediaFilename(fetch.submissionId, index, media),
  }));
}

/**
 * Same-item merge: title, body (selftext, Reddit URLs stripped,
 * unrelated prior text preserved), canonical url, media intents.
 */
export function mergeRedditIntoNote(
  note: RedditNoteSnapshot,
  fetch: RedditFetchSuccess,
  options?: { bodyUrlKeys?: string[] },
): RedditMergeResult {
  const bodyKeys = options?.bodyUrlKeys ?? [fetch.submissionId];
  return {
    title: deriveRedditTitle(fetch),
    body: mergeBlockReplacingMatchedUrls(
      note.body,
      (url) => redditUrlMatchesKeys(url, bodyKeys),
      buildRedditBodyBlock(fetch),
    ),
    url: fetch.sourceUrl,
    mediaIntents: listRedditMediaIntents(fetch),
  };
}

export function deriveRedditTitle(fetch: RedditFetchSuccess): string {
  if (fetch.title !== null) {
    const fromTitle = firstNonEmptyLine(fetch.title);
    if (fromTitle !== null) {
      return truncateTitle(fromTitle);
    }
  }
  if (fetch.selftext !== null) {
    const fromText = firstNonEmptyLine(fetch.selftext);
    if (fromText !== null) {
      return truncateTitle(fromText);
    }
  }
  if (fetch.authorUsername) {
    return `u/${fetch.authorUsername}`;
  }
  return "Reddit post";
}

function truncateTitle(line: string): string {
  return line.length <= REDDIT_TITLE_MAX_LENGTH
    ? line
    : line.slice(0, REDDIT_TITLE_MAX_LENGTH);
}

function buildRedditBodyBlock(fetch: RedditFetchSuccess): string {
  if (fetch.selftext !== null && firstNonEmptyLine(fetch.selftext) !== null) {
    return fetch.selftext.trimEnd();
  }
  return "";
}

function redditUrlMatchesKeys(url: string, urlKeys: string[]): boolean {
  const shortcode = parseRedditShortcode(url);
  return shortcode !== null && urlKeys.includes(shortcode);
}

function mediaFilename(
  submissionId: string,
  index: number,
  media: RedditFetchedMedia,
): string {
  return `${submissionId}-${index + 1}${extensionForMedia(media)}`;
}

function extensionForMedia(media: RedditFetchedMedia): string {
  const fromUrl = extensionFromUrl(media.url);
  if (fromUrl !== null) {
    return fromUrl;
  }
  return media.kind === "video" ? ".mp4" : ".jpg";
}
