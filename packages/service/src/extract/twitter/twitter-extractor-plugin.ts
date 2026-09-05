/**
 * Twitter/X ExtractorPlugin assembly (#954).
 * Wires discover → fetch → CDN download → attachMediaFiles → rewrite body
 * CDN `![]` to local paths → updateItem. Attach before update so article bodies
 * land with local paths in one CDN pass (unlike Instagram/Pinterest order).
 * Public content only — no user session / credentials.
 */

import type {
  AttachMediaFileInput,
  ExtractCandidate,
  ExtractorPlugin,
  GetItemResult,
  MediaWithPath,
  UpdateItemInput,
} from "@collector/api";
import { rewriteMarkdownRemoteImageUrls } from "@collector/core";
import { fetchExtractMediaBytes } from "../../fetch-extract-media-bytes.js";
import type { LookupHostAddresses } from "../../fetch-remote-bytes.js";
import { companionBodyUrlKeys } from "../companion-body-url-keys.js";
import { cdnDownloadHeaders } from "../cdn-download-headers.js";
import { downloadCdnMediaIntents } from "../download-cdn-media-intents.js";
import { fetchTwitterContent } from "./fetch.js";
import { TWITTER_WEB_ORIGIN } from "./http.js";
import { mergeTwitterIntoNote } from "./merge.js";
import {
  discoverTwitterCandidates,
  parseTwitterShortcode,
} from "./twitter-url-discover.js";
import type {
  FetchTwitterContentOptions,
  TwitterFetchResult,
  TwitterFetchSuccess,
  TwitterHttpFetch,
} from "./types.js";

export const TWITTER_PLUGIN_ID = "twitter";

const CDN_DOWNLOAD_HEADERS = cdnDownloadHeaders(TWITTER_WEB_ORIGIN);

function resolvedBodyKey(fetch: TwitterFetchSuccess): string {
  return fetch.kind === "article"
    ? `article:${fetch.contentId}`
    : fetch.contentId;
}

/** After attach, rewrite remote `![](cdn)` in body to local absolute paths. */
function bodyWithLocalMediaPaths(
  body: string,
  intents: { sourceUrl: string }[],
  attached: MediaWithPath[],
): string {
  if (intents.length === 0) {
    return body;
  }
  if (attached.length !== intents.length) {
    throw new Error(
      `Twitter extract: attach count ${attached.length} !== media intent count ${intents.length}`,
    );
  }
  const urlToLocal = new Map<string, string>();
  for (let i = 0; i < intents.length; i += 1) {
    urlToLocal.set(intents[i]!.sourceUrl, attached[i]!.absolute_path);
  }
  return rewriteMarkdownRemoteImageUrls(body, urlToLocal);
}

export type TwitterExtractorPluginDeps = {
  getItemById: (itemId: string) => Promise<GetItemResult>;
  updateItem: (itemId: string, input: UpdateItemInput) => Promise<unknown>;
  attachMediaFiles: (
    itemId: string,
    files: AttachMediaFileInput[],
  ) => Promise<MediaWithPath[]>;
  /** Override for offline tests. */
  fetchTwitterContentImpl?: (
    urlOrId: string,
    options?: FetchTwitterContentOptions,
  ) => Promise<TwitterFetchResult>;
  /** Override CDN download for offline tests. */
  fetchExtractMediaBytesImpl?: (
    url: string,
    options?: {
      fetchImpl?: TwitterHttpFetch;
      headers?: Record<string, string>;
      lookupAddresses?: LookupHostAddresses;
    },
  ) => Promise<Uint8Array>;
  fetchImpl?: TwitterHttpFetch;
  /** Offline tests: stub DNS for fixture CDN hosts. */
  lookupAddresses?: LookupHostAddresses;
};

export function createTwitterExtractorPlugin(
  deps: TwitterExtractorPluginDeps,
): ExtractorPlugin {
  const runFetch = deps.fetchTwitterContentImpl ?? fetchTwitterContent;
  const runDownload = deps.fetchExtractMediaBytesImpl ?? fetchExtractMediaBytes;

  return {
    id: TWITTER_PLUGIN_ID,

    discover(input) {
      return discoverTwitterCandidates(input).map(
        (candidate): ExtractCandidate => ({
          extractorId: candidate.extractorId,
          url: candidate.url,
          meta: { shortcode: candidate.shortcode },
        }),
      );
    },

    async extract(input) {
      const { itemId, candidate } = input;
      if (candidate.extractorId !== TWITTER_PLUGIN_ID) {
        throw new Error(
          `Twitter extractor received foreign extractorId: ${candidate.extractorId}`,
        );
      }

      const shortcode =
        candidate.meta?.shortcode?.trim() ||
        parseTwitterShortcode(candidate.url);
      if (!shortcode) {
        throw new Error(
          `Twitter import refused: cannot resolve content id from candidate ${candidate.url}`,
        );
      }

      // Import replaces a body URL. No matching link ⇒ already imported or invalid —
      // refuse before network/write so a second pass cannot duplicate text/media.
      const { content } = await deps.getItemById(itemId);
      const body = content ?? "";
      const pending = discoverTwitterCandidates({ body });
      if (!pending.some((entry) => entry.shortcode === shortcode)) {
        throw new Error(
          `Twitter import refused: no matching Twitter/X URL in note body for ${shortcode}`,
        );
      }

      const fetchOptions: FetchTwitterContentOptions = {};
      if (deps.fetchImpl) {
        fetchOptions.fetchImpl = deps.fetchImpl;
      }

      const fetchResult = await runFetch(candidate.url, fetchOptions);
      if (!fetchResult.ok) {
        throw new Error(
          `Twitter extract failed (${fetchResult.code}): ${fetchResult.message}`,
        );
      }

      const resolvedKey = resolvedBodyKey(fetchResult.value);
      const bodyUrlKeys = companionBodyUrlKeys(
        pending,
        shortcode,
        resolvedKey,
        "tco:",
      );
      const merged = mergeTwitterIntoNote(
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

      let nextBody = merged.body;
      if (files.length > 0) {
        const attached = await deps.attachMediaFiles(itemId, files);
        nextBody = bodyWithLocalMediaPaths(
          merged.body,
          merged.mediaIntents,
          attached,
        );
      }

      await deps.updateItem(itemId, {
        title: merged.title,
        content: nextBody,
        url: merged.url,
        content_type: "note",
      });
    },
  };
}
