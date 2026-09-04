export type {
  FetchTwitterContentOptions,
  TwitterContentKind,
  TwitterFetchErrorCode,
  TwitterFetchResult,
  TwitterFetchSuccess,
  TwitterFetchedMedia,
  TwitterHttpFetch,
  TwitterMediaIntent,
  TwitterMediaKind,
  TwitterMergeResult,
  TwitterNoteSnapshot,
} from "./types.js";

export { fetchTwitterContent } from "./fetch.js";
export {
  canonicalArticleUrl,
  canonicalStatusUrl,
  parseTwitterFetchTarget,
} from "./url.js";
export {
  TWITTER_TITLE_MAX_LENGTH,
  deriveTwitterTitle,
  listTwitterMediaIntents,
  mergeTwitterIntoNote,
} from "./merge.js";

export {
  discoverTwitterCandidates,
  parseTwitterShortcode,
  parseTwitterTarget,
  type TwitterExtractCandidate,
} from "./twitter-url-discover.js";

export {
  TWITTER_PLUGIN_ID,
  createTwitterExtractorPlugin,
  type TwitterExtractorPluginDeps,
} from "./twitter-extractor-plugin.js";
export { companionBodyUrlKeys } from "../companion-body-url-keys.js";
