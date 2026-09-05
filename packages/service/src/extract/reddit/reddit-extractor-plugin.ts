/**
 * Reddit ExtractorPlugin assembly (#955).
 * discover → fetch (browser cookies) → CDN download → updateItem → attachMediaFiles.
 * No Reddit OAuth API — session comes from Chrome/Chromium cookies when needed.
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
import { downloadCdnMediaIntents } from "../download-cdn-media-intents.js";
import { fetchRedditPost } from "./fetch.js";
import { REDDIT_WEB_ORIGIN } from "./http.js";
import { mergeRedditIntoNote } from "./merge.js";
import {
  discoverRedditCandidates,
  parseRedditShortcode,
} from "./reddit-url-discover.js";
import type {
  FetchRedditPostOptions,
  RedditFetchResult,
  RedditHttpFetch,
} from "./types.js";

export const REDDIT_PLUGIN_ID = "reddit";

const CDN_DOWNLOAD_HEADERS = cdnDownloadHeaders(REDDIT_WEB_ORIGIN);

export type RedditExtractorPluginDeps = {
  getItemById: (itemId: string) => Promise<GetItemResult>;
  updateItem: (itemId: string, input: UpdateItemInput) => Promise<unknown>;
  attachMediaFiles: (
    itemId: string,
    files: AttachMediaFileInput[],
  ) => Promise<unknown>;
  /** Override for offline tests. */
  fetchRedditPostImpl?: (
    urlOrId: string,
    options?: FetchRedditPostOptions,
  ) => Promise<RedditFetchResult>;
  /** Override CDN download for offline tests. */
  fetchExtractMediaBytesImpl?: (
    url: string,
    options?: {
      fetchImpl?: RedditHttpFetch;
      headers?: Record<string, string>;
      lookupAddresses?: LookupHostAddresses;
    },
  ) => Promise<Uint8Array>;
  fetchImpl?: RedditHttpFetch;
  /** Offline tests: skip browser cookie dump. */
  cookieHeader?: string;
  /** Offline tests: stub DNS for fixture CDN hosts. */
  lookupAddresses?: LookupHostAddresses;
};

export function createRedditExtractorPlugin(
  deps: RedditExtractorPluginDeps,
): ExtractorPlugin {
  const runFetch = deps.fetchRedditPostImpl ?? fetchRedditPost;
  const runDownload = deps.fetchExtractMediaBytesImpl ?? fetchExtractMediaBytes;

  return {
    id: REDDIT_PLUGIN_ID,

    discover(input) {
      return discoverRedditCandidates(input).map(
        (candidate): ExtractCandidate => ({
          extractorId: candidate.extractorId,
          url: candidate.url,
          meta: { shortcode: candidate.shortcode },
        }),
      );
    },

    async extract(input) {
      const { itemId, candidate } = input;
      if (candidate.extractorId !== REDDIT_PLUGIN_ID) {
        throw new Error(
          `Reddit extractor received foreign extractorId: ${candidate.extractorId}`,
        );
      }

      const shortcode =
        candidate.meta?.shortcode?.trim() ||
        parseRedditShortcode(candidate.url);
      if (!shortcode) {
        throw new Error(
          `Reddit import refused: cannot resolve submission id from candidate ${candidate.url}`,
        );
      }

      // Import replaces a body URL. No matching link ⇒ already imported or invalid —
      // refuse before network/write so a second pass cannot duplicate text/media.
      const { content } = await deps.getItemById(itemId);
      const body = content ?? "";
      const pending = discoverRedditCandidates({ body });
      if (!pending.some((entry) => entry.shortcode === shortcode)) {
        throw new Error(
          `Reddit import refused: no matching Reddit URL in note body for ${shortcode}`,
        );
      }

      const fetchOptions: FetchRedditPostOptions = {};
      if (deps.fetchImpl) {
        fetchOptions.fetchImpl = deps.fetchImpl;
      }
      if (deps.cookieHeader !== undefined) {
        fetchOptions.cookieHeader = deps.cookieHeader;
      }

      const fetchResult = await runFetch(candidate.url, fetchOptions);
      if (!fetchResult.ok) {
        throw new Error(
          `Reddit extract failed (${fetchResult.code}): ${fetchResult.message}`,
        );
      }

      const submissionId = fetchResult.value.submissionId;
      const bodyUrlKeys = [
        ...new Set([
          ...companionBodyUrlKeys(pending, shortcode, submissionId, "share:"),
          ...companionBodyUrlKeys(pending, shortcode, submissionId, "reddit:"),
        ]),
      ];
      const merged = mergeRedditIntoNote(
        { body },
        fetchResult.value,
        { bodyUrlKeys },
      );

      // Download all CDN bytes before any vault write so failures leave the note intact.
      const files = await downloadCdnMediaIntents(
        merged.mediaIntents,
        (sourceUrl) =>
          runDownload(sourceUrl, {
            fetchImpl: deps.fetchImpl,
            headers: CDN_DOWNLOAD_HEADERS,
            lookupAddresses: deps.lookupAddresses,
          }),
      );

      await deps.updateItem(itemId, {
        title: merged.title,
        content: merged.body,
        url: merged.url,
        content_type: "note",
      });
      if (files.length > 0) {
        await deps.attachMediaFiles(itemId, files);
      }
    },
  };
}
