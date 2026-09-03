export type {
  FetchPinterestPinOptions,
  PinterestFetchErrorCode,
  PinterestFetchResult,
  PinterestFetchSuccess,
  PinterestFetchedMedia,
  PinterestHttpFetch,
  PinterestMediaIntent,
  PinterestMediaKind,
  PinterestMergeResult,
  PinterestNoteSnapshot,
} from "./types.js";

export { fetchPinterestPin } from "./fetch.js";
export { canonicalPinUrl, parsePinterestTarget } from "./url.js";
export {
  PINTEREST_TITLE_MAX_LENGTH,
  derivePinterestTitle,
  listPinterestMediaIntents,
  mergePinterestIntoNote,
} from "./merge.js";

export {
  discoverPinterestCandidates,
  parsePinterestPin,
  parsePinterestPinIdFromSegment,
  parsePinterestShortcode,
  type PinterestExtractCandidate,
} from "./pinterest-url-discover.js";

export {
  PINTEREST_PLUGIN_ID,
  createPinterestExtractorPlugin,
  type PinterestExtractorPluginDeps,
} from "./pinterest-extractor-plugin.js";
