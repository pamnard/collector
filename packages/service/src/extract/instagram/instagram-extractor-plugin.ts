/**
 * Instagram ExtractorPlugin assembly (#318).
 * Wires discover → fetch → CDN download → merge → updateItem → attachMediaFiles.
 * Public posts only — no user session / credentials.
 */

import type {
  AttachMediaFileInput,
  ExtractCandidate,
  ExtractorPlugin,
  GetItemResult,
  UpdateItemInput,
} from "@collector/api";
import { fetchExtractMediaBytes } from "../../fetch-extract-media-bytes.js";
import { discoverInstagramCandidates } from "./instagram-url-discover.js";
import { fetchInstagramMedia } from "./fetch.js";
import { IG_WEB_ORIGIN } from "./http.js";
import { mergeInstagramIntoNote } from "./merge.js";
import type {
  FetchInstagramMediaOptions,
  InstagramFetchResult,
  InstagramHttpFetch,
} from "./types.js";

export const INSTAGRAM_PLUGIN_ID = "instagram";

const CDN_DOWNLOAD_HEADERS: Record<string, string> = {
  Referer: `${IG_WEB_ORIGIN}/`,
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

export type InstagramExtractorPluginDeps = {
  getItemById: (itemId: string) => Promise<GetItemResult>;
  updateItem: (itemId: string, input: UpdateItemInput) => Promise<unknown>;
  attachMediaFiles: (
    itemId: string,
    files: AttachMediaFileInput[],
  ) => Promise<unknown>;
  /** Override for offline tests. */
  fetchInstagramMediaImpl?: (
    urlOrShortcode: string,
    options?: FetchInstagramMediaOptions,
  ) => Promise<InstagramFetchResult>;
  /** Override CDN download for offline tests. */
  fetchExtractMediaBytesImpl?: (
    url: string,
    options?: {
      fetchImpl?: InstagramHttpFetch;
      headers?: Record<string, string>;
    },
  ) => Promise<Uint8Array>;
  fetchImpl?: InstagramHttpFetch;
};

export function createInstagramExtractorPlugin(
  deps: InstagramExtractorPluginDeps,
): ExtractorPlugin {
  const runFetch = deps.fetchInstagramMediaImpl ?? fetchInstagramMedia;
  const runDownload = deps.fetchExtractMediaBytesImpl ?? fetchExtractMediaBytes;

  return {
    id: INSTAGRAM_PLUGIN_ID,

    discover(input) {
      return discoverInstagramCandidates(input).map(
        (candidate): ExtractCandidate => ({
          extractorId: candidate.extractorId,
          url: candidate.url,
          meta: { shortcode: candidate.shortcode },
        }),
      );
    },

    async extract(input) {
      const { itemId, candidate } = input;
      if (candidate.extractorId !== INSTAGRAM_PLUGIN_ID) {
        throw new Error(
          `Instagram extractor received foreign extractorId: ${candidate.extractorId}`,
        );
      }

      const fetchOptions: FetchInstagramMediaOptions = {};
      if (deps.fetchImpl) {
        fetchOptions.fetchImpl = deps.fetchImpl;
      }

      const fetchResult = await runFetch(candidate.url, fetchOptions);
      if (!fetchResult.ok) {
        throw new Error(
          `Instagram extract failed (${fetchResult.code}): ${fetchResult.message}`,
        );
      }

      const { content } = await deps.getItemById(itemId);
      const merged = mergeInstagramIntoNote(
        { body: content ?? "" },
        fetchResult.value,
      );
      if (merged.mediaIntents.length === 0) {
        throw new Error(
          "Instagram extract failed (no_media): fetch succeeded with empty mediaIntents",
        );
      }

      // Download all CDN bytes before any vault write so failures leave the note intact.
      const files: AttachMediaFileInput[] = [];
      for (const intent of merged.mediaIntents) {
        const bytes = await runDownload(intent.sourceUrl, {
          fetchImpl: deps.fetchImpl,
          headers: CDN_DOWNLOAD_HEADERS,
        });
        files.push({ name: intent.filename, bytes });
      }

      await deps.updateItem(itemId, {
        title: merged.title,
        content: merged.body,
        url: merged.url,
        content_type: "note",
      });
      await deps.attachMediaFiles(itemId, files);
    },
  };
}
