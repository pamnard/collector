/**
 * Pure YouTube → same-note merge helpers (#317).
 * No HTTP, vault writes, or attachMediaFiles — assembly is the plugin.
 */

import {
  firstNonEmptyLine,
  mergeBlockReplacingMatchedUrls,
} from "../merge-text.js";
import { parseYoutubeShortcode } from "./youtube-url-discover.js";
import type {
  YoutubeFetchSuccess,
  YoutubeMediaIntent,
  YoutubeMergeResult,
  YoutubeNoteSnapshot,
} from "./types.js";

/** Matches item title schema max (`packages/shared` title ≤500). */
export const YOUTUBE_TITLE_MAX_LENGTH = 500;

/**
 * Media attachment intents from an already-downloaded video on disk.
 */
export function listYoutubeMediaIntents(
  fetch: YoutubeFetchSuccess,
): YoutubeMediaIntent[] {
  return [
    {
      kind: "video",
      filename: fetch.videoFilename,
      absolutePath: fetch.videoPath,
    },
  ];
}

/**
 * Same-item merge: title, body (transcript when present, YouTube URLs stripped,
 * unrelated prior text preserved), canonical url, media intents.
 */
export function mergeYoutubeIntoNote(
  note: YoutubeNoteSnapshot,
  fetch: YoutubeFetchSuccess,
  options?: { bodyUrlKeys?: string[] },
): YoutubeMergeResult {
  const bodyKeys = options?.bodyUrlKeys ?? [fetch.videoId];
  const bodyBlock =
    fetch.transcript !== null &&
    firstNonEmptyLine(fetch.transcript) !== null
      ? fetch.transcript.trimEnd()
      : "";

  return {
    title: deriveYoutubeTitle(fetch),
    body: mergeBlockReplacingMatchedUrls(
      note.body,
      (url) => youtubeUrlMatchesKeys(url, bodyKeys),
      bodyBlock,
    ),
    url: fetch.sourceUrl,
    mediaIntents: listYoutubeMediaIntents(fetch),
  };
}

export function deriveYoutubeTitle(fetch: YoutubeFetchSuccess): string {
  const line = firstNonEmptyLine(fetch.title);
  if (line === null) {
    throw new Error(
      "YouTube merge refused: fetch title is empty (no_title)",
    );
  }
  return line.length <= YOUTUBE_TITLE_MAX_LENGTH
    ? line
    : line.slice(0, YOUTUBE_TITLE_MAX_LENGTH);
}

function youtubeUrlMatchesKeys(url: string, urlKeys: string[]): boolean {
  const videoId = parseYoutubeShortcode(url);
  return videoId !== null && urlKeys.includes(videoId);
}
