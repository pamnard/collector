export type {
  FetchRedditPostOptions,
  RedditFetchErrorCode,
  RedditFetchResult,
  RedditFetchSuccess,
  RedditFetchedMedia,
  RedditHttpFetch,
  RedditMediaIntent,
  RedditMediaKind,
  RedditMergeResult,
  RedditNoteSnapshot,
} from "./types.js";

export { fetchRedditPost } from "./fetch.js";
export { canonicalPostUrl, canonicalShareUrl, parseRedditFetchTarget } from "./url.js";
export {
  REDDIT_TITLE_MAX_LENGTH,
  deriveRedditTitle,
  listRedditMediaIntents,
  mergeRedditIntoNote,
} from "./merge.js";

export {
  discoverRedditCandidates,
  parseRedditShortcode,
  parseRedditTarget,
  type RedditExtractCandidate,
} from "./reddit-url-discover.js";

export {
  REDDIT_PLUGIN_ID,
  createRedditExtractorPlugin,
  type RedditExtractorPluginDeps,
} from "./reddit-extractor-plugin.js";
