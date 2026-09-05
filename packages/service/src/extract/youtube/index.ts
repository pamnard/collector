export type {
  FetchYoutubeOptions,
  YoutubeFetchErrorCode,
  YoutubeFetchResult,
  YoutubeFetchSuccess,
  YoutubeMediaIntent,
  YoutubeMergeResult,
  YoutubeNoteSnapshot,
} from "./types.js";

export { fetchYoutubeVideo } from "./fetch.js";
export {
  youtubeFormatForMaxHeight,
  youtubeMaxHeightForDurationSeconds,
  YOUTUBE_DURATION_720_MAX_SECONDS,
  type YoutubeMaxHeight,
} from "./duration-height.js";

export {
  YOUTUBE_TITLE_MAX_LENGTH,
  deriveYoutubeTitle,
  listYoutubeMediaIntents,
  mergeYoutubeIntoNote,
} from "./merge.js";

export { resolveYtdlpBinary } from "./resolve-ytdlp.js";

export {
  discoverYoutubeCandidates,
  parseYoutubeShortcode,
  type YoutubeExtractCandidate,
} from "./youtube-url-discover.js";

export {
  YOUTUBE_PLUGIN_ID,
  createYoutubeExtractorPlugin,
  type YoutubeAttachFromPathInput,
  type YoutubeExtractorPluginDeps,
} from "./youtube-extractor-plugin.js";
