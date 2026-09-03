/**
 * YouTube ExtractorPlugin assembly (#317).
 * Wires discover → yt-dlp fetch → merge → attachMediaFiles → updateItem.
 * Attach runs before body strip so a failed attach leaves the URL for retry.
 */

import type {
  AttachMediaFileInput,
  ExtractCandidate,
  ExtractorPlugin,
  GetItemResult,
  UpdateItemInput,
} from "@collector/api";
import { fetchYoutubeVideo } from "./fetch.js";
import { mergeYoutubeIntoNote } from "./merge.js";
import type {
  FetchYoutubeOptions,
  YoutubeFetchResult,
} from "./types.js";
import {
  discoverYoutubeCandidates,
  parseYoutubeShortcode,
} from "./youtube-url-discover.js";

export const YOUTUBE_PLUGIN_ID = "youtube";

export type YoutubeExtractorPluginDeps = {
  getItemById: (itemId: string) => Promise<GetItemResult>;
  updateItem: (itemId: string, input: UpdateItemInput) => Promise<unknown>;
  attachMediaFiles: (
    itemId: string,
    files: AttachMediaFileInput[],
  ) => Promise<unknown>;
  /** Override for offline tests. */
  fetchYoutubeImpl?: (
    url: string,
    options?: FetchYoutubeOptions,
  ) => Promise<YoutubeFetchResult>;
};

export function createYoutubeExtractorPlugin(
  deps: YoutubeExtractorPluginDeps,
): ExtractorPlugin {
  const runFetch = deps.fetchYoutubeImpl ?? fetchYoutubeVideo;

  return {
    id: YOUTUBE_PLUGIN_ID,

    discover(input) {
      return discoverYoutubeCandidates(input).map(
        (candidate): ExtractCandidate => ({
          extractorId: candidate.extractorId,
          url: candidate.url,
          meta: { shortcode: candidate.shortcode },
        }),
      );
    },

    async extract(input) {
      const { itemId, candidate } = input;
      if (candidate.extractorId !== YOUTUBE_PLUGIN_ID) {
        throw new Error(
          `YouTube extractor received foreign extractorId: ${candidate.extractorId}`,
        );
      }

      const videoId =
        candidate.meta?.shortcode?.trim() ||
        parseYoutubeShortcode(candidate.url);
      if (!videoId) {
        throw new Error(
          `YouTube import refused: cannot resolve video id from candidate ${candidate.url}`,
        );
      }

      // Import replaces a body URL. No matching link ⇒ already imported or invalid —
      // refuse before network/write so a second pass cannot duplicate media/text.
      const { content } = await deps.getItemById(itemId);
      const body = content ?? "";
      const pending = discoverYoutubeCandidates({ body });
      if (!pending.some((entry) => entry.shortcode === videoId)) {
        throw new Error(
          `YouTube import refused: no matching YouTube URL in note body for ${videoId}`,
        );
      }

      const fetchResult = await runFetch(candidate.url);
      if (!fetchResult.ok) {
        throw new Error(
          `YouTube extract failed (${fetchResult.code}): ${fetchResult.message}`,
        );
      }

      const merged = mergeYoutubeIntoNote(
        { body },
        fetchResult.value,
        { bodyUrlKeys: [videoId] },
      );

      const files: AttachMediaFileInput[] = merged.mediaIntents.map(
        (intent) => ({
          name: intent.filename,
          bytes: intent.bytes,
        }),
      );

      // Attach first: if this throws, body URL remains for a retry.
      await deps.attachMediaFiles(itemId, files);
      await deps.updateItem(itemId, {
        title: merged.title,
        content: merged.body,
        url: merged.url,
        content_type: "note",
      });
    },
  };
}
