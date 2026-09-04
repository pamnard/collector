/**
 * Pure Twitter/X → same-note merge helpers (#954).
 * No HTTP, vault writes, or attachMediaFiles — assembly is the plugin.
 */

import {
  extensionFromUrl,
  firstNonEmptyLine,
  mergeBlockReplacingMatchedUrls,
} from "../merge-text.js";
import { parseTwitterShortcode } from "./twitter-url-discover.js";
import type {
  TwitterFetchSuccess,
  TwitterFetchedMedia,
  TwitterMediaIntent,
  TwitterMergeResult,
  TwitterNoteSnapshot,
} from "./types.js";

/** Matches item title schema max (`packages/shared` title ≤500). */
export const TWITTER_TITLE_MAX_LENGTH = 500;

/**
 * Media attachment intents for later download + attachMediaFiles.
 */
export function listTwitterMediaIntents(
  fetch: TwitterFetchSuccess,
): TwitterMediaIntent[] {
  return fetch.media.map((media, index) => ({
    kind: media.kind,
    sourceUrl: media.url,
    filename: mediaFilename(fetch.contentId, index, media),
  }));
}

/**
 * Same-item merge: title, body (text, Twitter URLs stripped,
 * unrelated prior text preserved), canonical url, media intents.
 */
export function mergeTwitterIntoNote(
  note: TwitterNoteSnapshot,
  fetch: TwitterFetchSuccess,
  options?: { bodyUrlKeys?: string[] },
): TwitterMergeResult {
  const bodyKeys =
    options?.bodyUrlKeys ??
    [
      fetch.kind === "article"
        ? `article:${fetch.contentId}`
        : fetch.contentId,
    ];
  return {
    title: deriveTwitterTitle(fetch),
    body: mergeBlockReplacingMatchedUrls(
      note.body,
      (url) => twitterUrlMatchesKeys(url, bodyKeys),
      buildTwitterBodyBlock(fetch),
    ),
    url: fetch.sourceUrl,
    mediaIntents: listTwitterMediaIntents(fetch),
  };
}

export function deriveTwitterTitle(fetch: TwitterFetchSuccess): string {
  if (fetch.title !== null) {
    const fromTitle = firstNonEmptyLine(fetch.title);
    if (fromTitle !== null) {
      return truncateTitle(fromTitle);
    }
  }
  if (fetch.text !== null) {
    const fromText = firstNonEmptyLine(fetch.text);
    if (fromText !== null) {
      return truncateTitle(fromText);
    }
  }
  if (fetch.authorUsername) {
    return `@${fetch.authorUsername}`;
  }
  return fetch.kind === "article" ? "X article" : "X post";
}

function truncateTitle(line: string): string {
  return line.length <= TWITTER_TITLE_MAX_LENGTH
    ? line
    : line.slice(0, TWITTER_TITLE_MAX_LENGTH);
}

function buildTwitterBodyBlock(fetch: TwitterFetchSuccess): string {
  let text = "";
  if (fetch.text !== null && firstNonEmptyLine(fetch.text) !== null) {
    text = fetch.text.trimEnd();
  } else if (fetch.title !== null && firstNonEmptyLine(fetch.title) !== null) {
    text = fetch.title.trimEnd();
  }
  if (fetch.kind === "article") {
    return ensureArticleInlineMedia(text, fetch.media);
  }
  return text;
}

/**
 * Articles must carry every media URL as `![](…)` so localize attaches once.
 * DraftJS-built bodies already include embeds; collector-block fixtures may not.
 */
function ensureArticleInlineMedia(
  text: string,
  media: TwitterFetchedMedia[],
): string {
  const missing = media.filter((entry) => !bodyHasMarkdownMedia(text, entry.url));
  if (missing.length === 0) {
    return text;
  }
  const embeds = missing.map((entry) => `![](${entry.url})`).join("\n\n");
  if (text.length === 0) {
    return embeds;
  }
  return `${text}\n\n${embeds}`;
}

function bodyHasMarkdownMedia(body: string, url: string): boolean {
  return body.includes(`](${url})`);
}

function twitterUrlMatchesKeys(url: string, urlKeys: string[]): boolean {
  const shortcode = parseTwitterShortcode(url);
  return shortcode !== null && urlKeys.includes(shortcode);
}

function mediaFilename(
  contentId: string,
  index: number,
  media: TwitterFetchedMedia,
): string {
  return `${contentId}-${index + 1}${extensionForMedia(media)}`;
}

function extensionForMedia(media: TwitterFetchedMedia): string {
  const fromUrl = extensionFromUrl(media.url);
  if (fromUrl !== null) {
    return fromUrl;
  }
  return media.kind === "video" ? ".mp4" : ".jpg";
}
