/**
 * Pure YouTube URL discovery for extract (#317).
 * No network — finds watch/shorts/youtu.be URLs in note body only.
 */

import { parseYouTubeVideoId } from "@collector/core";
import { collectHttpUrlsFromBody } from "../collect-http-urls.js";

export type YoutubeExtractCandidate = {
  extractorId: "youtube";
  /** Normalized https watch URL */
  url: string;
  /** Video id — also ExtractCandidate.meta.shortcode for extract_auto. */
  shortcode: string;
};

/**
 * Stable extract key from a YouTube URL, or null when not a video URL.
 */
export function parseYoutubeShortcode(url: string): string | null {
  return parseYouTubeVideoId(url);
}

function candidateFromUrl(raw: string): YoutubeExtractCandidate | null {
  const videoId = parseYouTubeVideoId(raw);
  if (videoId === null) {
    return null;
  }
  return {
    extractorId: "youtube",
    url: `https://www.youtube.com/watch?v=${videoId}`,
    shortcode: videoId,
  };
}

/**
 * Discover YouTube extract candidates from note body only.
 * Frontmatter `url` is the stored canonical link after import — not a pending
 * import signal (#317). Dedupes by video id (first occurrence wins).
 */
export function discoverYoutubeCandidates(input: {
  body: string;
  /** Ignored for candidates — kept for call-site compatibility. */
  frontmatterUrl?: string | null;
}): YoutubeExtractCandidate[] {
  const byShortcode = new Map<string, YoutubeExtractCandidate>();

  for (const raw of collectHttpUrlsFromBody(input.body)) {
    const candidate = candidateFromUrl(raw);
    if (!candidate || byShortcode.has(candidate.shortcode)) {
      continue;
    }
    byShortcode.set(candidate.shortcode, candidate);
  }

  return [...byShortcode.values()];
}
