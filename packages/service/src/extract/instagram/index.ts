export type {
  FetchInstagramMediaOptions,
  InstagramFetchErrorCode,
  InstagramFetchResult,
  InstagramFetchSuccess,
  InstagramFetchedMedia,
  InstagramHttpFetch,
  InstagramMediaIntent,
  InstagramMediaKind,
  InstagramMergeResult,
  InstagramNoteSnapshot,
} from "./types.js";

export { fetchInstagramMedia } from "./fetch.js";
export { parseInstagramTarget } from "./url.js";
export {
  parseApiMediaItem,
  parseGraphqlShortcodeMedia,
} from "./parse-media.js";
export { shortcodeToMediaId } from "./media-id.js";

export {
  INSTAGRAM_TITLE_MAX_LENGTH,
  deriveInstagramTitle,
  listInstagramMediaIntents,
  mergeInstagramIntoNote,
} from "./merge.js";

export {
  discoverInstagramCandidates,
  parseInstagramShortcode,
  type InstagramExtractCandidate,
} from "./instagram-url-discover.js";

export {
  INSTAGRAM_PLUGIN_ID,
  INSTAGRAM_SESSION_COOKIES_KEY,
  createInstagramExtractorPlugin,
  type InstagramExtractorPluginDeps,
} from "./instagram-extractor-plugin.js";
