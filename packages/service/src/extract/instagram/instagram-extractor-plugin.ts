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
import type { LookupHostAddresses } from "../../fetch-remote-bytes.js";
import { cdnDownloadHeaders } from "../cdn-download-headers.js";
import { discoverInstagramCandidates, parseInstagramShortcode } from "./instagram-url-discover.js";
import { fetchInstagramMedia } from "./fetch.js";
import { IG_WEB_ORIGIN } from "./http.js";
import { mergeInstagramIntoNote } from "./merge.js";
import type {
  FetchInstagramMediaOptions,
  InstagramFetchResult,
  InstagramHttpFetch,
} from "./types.js";

export const INSTAGRAM_PLUGIN_ID = "instagram";

const CDN_DOWNLOAD_HEADERS = cdnDownloadHeaders(IG_WEB_ORIGIN);

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
      lookupAddresses?: LookupHostAddresses;
    },
  ) => Promise<Uint8Array>;
  fetchImpl?: InstagramHttpFetch;
  /** Offline tests: stub DNS for fixture CDN hosts. */
  lookupAddresses?: LookupHostAddresses;
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

      const shortcode =
        candidate.meta?.shortcode?.trim() ||
        parseInstagramShortcode(candidate.url);
      if (!shortcode) {
        throw new Error(
          `Instagram import refused: cannot resolve shortcode from candidate ${candidate.url}`,
        );
      }

      // Import replaces a body URL. No matching link ⇒ already imported or invalid —
      // refuse before network/write so a second pass cannot duplicate caption/media.
      const { content } = await deps.getItemById(itemId);
      const body = content ?? "";
      const pending = discoverInstagramCandidates({ body });
      if (!pending.some((entry) => entry.shortcode === shortcode)) {
        throw new Error(
          `Instagram import refused: no matching Instagram URL in note body for ${shortcode}`,
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

      const merged = mergeInstagramIntoNote({ body }, fetchResult.value);
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
          lookupAddresses: deps.lookupAddresses,
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
