/**
 * Pinterest ExtractorPlugin assembly (#34).
 * Wires discover → fetch → CDN download → merge → updateItem → attachMediaFiles.
 * Public pins only — no user session / credentials.
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
import { companionBodyUrlKeys } from "../companion-body-url-keys.js";
import { cdnDownloadHeaders } from "../cdn-download-headers.js";
import { fetchPinterestPin } from "./fetch.js";
import { PINTEREST_WEB_ORIGIN } from "./http.js";
import { mergePinterestIntoNote } from "./merge.js";
import {
  discoverPinterestCandidates,
  parsePinterestShortcode,
} from "./pinterest-url-discover.js";
import type {
  FetchPinterestPinOptions,
  PinterestFetchResult,
  PinterestHttpFetch,
} from "./types.js";

export const PINTEREST_PLUGIN_ID = "pinterest";

const CDN_DOWNLOAD_HEADERS = cdnDownloadHeaders(PINTEREST_WEB_ORIGIN);

export type PinterestExtractorPluginDeps = {
  getItemById: (itemId: string) => Promise<GetItemResult>;
  updateItem: (itemId: string, input: UpdateItemInput) => Promise<unknown>;
  attachMediaFiles: (
    itemId: string,
    files: AttachMediaFileInput[],
  ) => Promise<unknown>;
  /** Override for offline tests. */
  fetchPinterestPinImpl?: (
    urlOrPinId: string,
    options?: FetchPinterestPinOptions,
  ) => Promise<PinterestFetchResult>;
  /** Override CDN download for offline tests. */
  fetchExtractMediaBytesImpl?: (
    url: string,
    options?: {
      fetchImpl?: PinterestHttpFetch;
      headers?: Record<string, string>;
      lookupAddresses?: LookupHostAddresses;
    },
  ) => Promise<Uint8Array>;
  fetchImpl?: PinterestHttpFetch;
  /** Offline tests: stub DNS for fixture CDN hosts. */
  lookupAddresses?: LookupHostAddresses;
};

export function createPinterestExtractorPlugin(
  deps: PinterestExtractorPluginDeps,
): ExtractorPlugin {
  const runFetch = deps.fetchPinterestPinImpl ?? fetchPinterestPin;
  const runDownload = deps.fetchExtractMediaBytesImpl ?? fetchExtractMediaBytes;

  return {
    id: PINTEREST_PLUGIN_ID,

    discover(input) {
      return discoverPinterestCandidates(input).map(
        (candidate): ExtractCandidate => ({
          extractorId: candidate.extractorId,
          url: candidate.url,
          meta: { shortcode: candidate.shortcode },
        }),
      );
    },

    async extract(input) {
      const { itemId, candidate } = input;
      if (candidate.extractorId !== PINTEREST_PLUGIN_ID) {
        throw new Error(
          `Pinterest extractor received foreign extractorId: ${candidate.extractorId}`,
        );
      }

      const shortcode =
        candidate.meta?.shortcode?.trim() ||
        parsePinterestShortcode(candidate.url);
      if (!shortcode) {
        throw new Error(
          `Pinterest import refused: cannot resolve pin id from candidate ${candidate.url}`,
        );
      }

      // Import replaces a body URL. No matching link ⇒ already imported or invalid —
      // refuse before network/write so a second pass cannot duplicate caption/media.
      const { content } = await deps.getItemById(itemId);
      const body = content ?? "";
      const pending = discoverPinterestCandidates({ body });
      if (!pending.some((entry) => entry.shortcode === shortcode)) {
        throw new Error(
          `Pinterest import refused: no matching Pinterest URL in note body for ${shortcode}`,
        );
      }

      const fetchOptions: FetchPinterestPinOptions = {};
      if (deps.fetchImpl) {
        fetchOptions.fetchImpl = deps.fetchImpl;
      }

      const fetchResult = await runFetch(candidate.url, fetchOptions);
      if (!fetchResult.ok) {
        throw new Error(
          `Pinterest extract failed (${fetchResult.code}): ${fetchResult.message}`,
        );
      }

      const bodyUrlKeys = companionBodyUrlKeys(
        pending,
        shortcode,
        fetchResult.value.pinId,
        "pinit:",
      );
      const merged = mergePinterestIntoNote(
        { body },
        fetchResult.value,
        { bodyUrlKeys },
      );
      if (merged.mediaIntents.length === 0) {
        throw new Error(
          "Pinterest extract failed (no_media): fetch succeeded with empty mediaIntents",
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
