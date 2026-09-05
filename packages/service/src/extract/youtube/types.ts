/**
 * Shared YouTube extract contracts (#317).
 */

/** Successful fetch payload — input to same-item merge + attach. */
export type YoutubeFetchSuccess = {
  sourceUrl: string;
  videoId: string;
  /** Non-empty video title from yt-dlp metadata. */
  title: string;
  /**
   * Transcript text when subtitles/auto-subs exist.
   * `null` = absent (caller must not invent empty success text).
   */
  transcript: string | null;
  /** Absolute path to the merged video file on disk (caller attaches then releases). */
  videoPath: string;
  /** Suggested attachment filename (e.g. `{videoId}.mp4`). */
  videoFilename: string;
  /** Remove temp download directory after attach (or on failure after fetch). */
  release: () => void;
};

export type YoutubeFetchErrorCode =
  | "binary_missing"
  | "cookies_unavailable"
  | "bot_wall"
  | "download_failed"
  | "no_video"
  | "no_title"
  | "invalid_url"
  | "no_duration"
  | "no_audio"
  | "incomplete_download";

export type YoutubeFetchResult =
  | { ok: true; value: YoutubeFetchSuccess }
  | { ok: false; code: YoutubeFetchErrorCode; message: string };

export type YoutubeExecFile = (
  file: string,
  args: readonly string[],
  options: {
    maxBuffer?: number;
    timeout?: number;
    encoding?: BufferEncoding;
  },
) => Promise<{ stdout: string; stderr: string }>;

export type FetchYoutubeOptions = {
  /** Override binary resolve (tests). */
  ytdlpBinary?: string;
  /** Override ffmpeg location passed to yt-dlp (tests). */
  ffmpegBinary?: string | null;
  /** Override `--cookies-from-browser` value (tests). */
  cookiesBrowser?: string | null;
  /** Override Node path for `--js-runtimes` (tests). */
  nodeBinary?: string;
  /** Override process spawn (unit tests). */
  execFileImpl?: YoutubeExecFile;
  /** Override audio-stream probe (unit tests). */
  probeHasAudioImpl?: (videoPath: string) => Promise<boolean>;
};

export type YoutubeMediaIntent = {
  kind: "video";
  filename: string;
  absolutePath: string;
};

export type YoutubeMergeResult = {
  title: string;
  body: string;
  url: string;
  mediaIntents: YoutubeMediaIntent[];
};

export type YoutubeNoteSnapshot = {
  body: string;
};
