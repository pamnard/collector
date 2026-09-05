/**
 * YouTube fetch via bundled yt-dlp (#317).
 * Offline tests inject `fetchYoutubeImpl` / `execFileImpl` — no live network in unit CI.
 *
 * Uses Chrome/Chromium cookies + Node JS challenge runtime (YouTube bot wall).
 * Video is downloaded to a temp path; auto-subs are a separate best-effort pass (no wide -i).
 * No max-filesize ceiling — large files attach from disk without buffering into heap.
 */

import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { promisify } from "node:util";
import { parseYouTubeVideoId } from "@collector/core";
import { resolveFfmpegBinary } from "../../host/node-cover.js";
import {
  youtubeFormatForMaxHeight,
  youtubeMaxHeightForDurationSeconds,
} from "./duration-height.js";
import { resolveYoutubeCookiesBrowser } from "./resolve-cookies-browser.js";
import { resolveYtdlpBinary } from "./resolve-ytdlp.js";
import type {
  FetchYoutubeOptions,
  YoutubeExecFile,
  YoutubeFetchErrorCode,
  YoutubeFetchResult,
  YoutubeFetchSuccess,
} from "./types.js";

const defaultExecFile: YoutubeExecFile = promisify(execFile) as YoutubeExecFile;

/** Download may be multi‑hundred MB; allow a long run. */
export const YOUTUBE_DOWNLOAD_TIMEOUT_MS = 3 * 60 * 60 * 1000;
export const YOUTUBE_PROBE_TIMEOUT_MS = 2 * 60 * 1000;
export const YOUTUBE_SUBS_TIMEOUT_MS = 2 * 60 * 1000;

/** Valid yt-dlp lang regex — bare `*` is rejected. */
export const YOUTUBE_SUB_LANGS = "en.*,ru.*";

const VIDEO_EXTS = new Set([".mp4", ".webm", ".mkv", ".mov"]);
const SUB_EXTS = new Set([".vtt", ".srt", ".ttml", ".srv3", ".json3"]);

export async function fetchYoutubeVideo(
  url: string,
  options: FetchYoutubeOptions = {},
): Promise<YoutubeFetchResult> {
  const videoId = parseYouTubeVideoId(url);
  if (videoId === null) {
    return {
      ok: false,
      code: "invalid_url",
      message: `Not a YouTube video URL: ${url}`,
    };
  }

  const ytdlp = options.ytdlpBinary ?? resolveYtdlpBinary();
  if (ytdlp === null) {
    return {
      ok: false,
      code: "binary_missing",
      message:
        "yt-dlp binary not found (expected packaged host bin/yt-dlp)",
    };
  }

  const cookiesBrowser =
    options.cookiesBrowser === undefined
      ? resolveYoutubeCookiesBrowser()
      : options.cookiesBrowser;
  if (cookiesBrowser === null || cookiesBrowser.trim().length === 0) {
    return {
      ok: false,
      code: "cookies_unavailable",
      message:
        "YouTube extract needs Chrome/Chromium cookies (log into YouTube in the browser, or set COLLECTOR_YT_COOKIES_BROWSER)",
    };
  }

  const ffmpeg =
    options.ffmpegBinary === undefined
      ? resolveFfmpegBinary()
      : options.ffmpegBinary;
  const nodeBinary = options.nodeBinary ?? process.execPath;
  const runExec = options.execFileImpl ?? defaultExecFile;

  const workDir = mkdtempSync(join(tmpdir(), "collector-yt-"));
  let released = false;
  const release = (): void => {
    if (released) {
      return;
    }
    released = true;
    rmSync(workDir, { recursive: true, force: true });
  };

  try {
    const commonPrefix = buildCommonArgs({
      nodeBinary,
      cookiesBrowser,
      ffmpeg,
    });

    const durationProbe = await probeDurationSeconds(
      runExec,
      ytdlp,
      commonPrefix,
      url,
    );
    if (!durationProbe.ok) {
      release();
      return durationProbe;
    }

    const maxHeight = youtubeMaxHeightForDurationSeconds(
      durationProbe.durationSeconds,
    );
    const format = youtubeFormatForMaxHeight(maxHeight);
    const outTemplate = join(workDir, "%(id)s.%(ext)s");

    const videoArgs = [
      ...commonPrefix,
      "-f",
      format,
      "-o",
      outTemplate,
      "--print",
      "%(title)s",
      "--print",
      "after_move:filepath",
      url,
    ];

    let stdout: string;
    try {
      const result = await runExec(ytdlp, videoArgs, {
        maxBuffer: 16 * 1024 * 1024,
        timeout: YOUTUBE_DOWNLOAD_TIMEOUT_MS,
        encoding: "utf8",
      });
      stdout = result.stdout;
    } catch (error) {
      release();
      return classifyExecFailure(error);
    }

    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const titleLine = lines[0] ?? "";
    if (titleLine.length === 0) {
      release();
      return {
        ok: false,
        code: "no_title",
        message: "yt-dlp returned an empty title",
      };
    }

    const videoPath = findDownloadedVideo(workDir, videoId, lines.slice(1));
    if (videoPath === null) {
      release();
      return {
        ok: false,
        code: "incomplete_download",
        message: `yt-dlp finished without a merged video file for ${videoId}`,
      };
    }

    const size = statSync(videoPath).size;
    if (size === 0) {
      release();
      return {
        ok: false,
        code: "no_video",
        message: `Downloaded video is empty for ${videoId}`,
      };
    }

    const probeHasAudio =
      options.probeHasAudioImpl ??
      ((path: string) => probeVideoHasAudio(path, ffmpeg));
    const hasAudio = await probeHasAudio(videoPath);
    if (!hasAudio) {
      release();
      return {
        ok: false,
        code: "no_audio",
        message: `Downloaded video has no audio stream for ${videoId}`,
      };
    }

    // Best-effort transcript: failure leaves transcript null (video already ok).
    await tryWriteAutoSubs(runExec, ytdlp, commonPrefix, workDir, url);

    const transcript = readTranscriptText(workDir, videoId);
    const ext = extname(videoPath).toLowerCase() || ".mp4";

    const value: YoutubeFetchSuccess = {
      sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
      videoId,
      title: titleLine,
      transcript,
      videoPath,
      videoFilename: `${videoId}${ext}`,
      release,
    };
    return { ok: true, value };
  } catch (error) {
    release();
    throw error;
  }
}

function buildCommonArgs(input: {
  nodeBinary: string;
  cookiesBrowser: string;
  ffmpeg: string | null | undefined;
}): string[] {
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--js-runtimes",
    `node:${input.nodeBinary}`,
    "--cookies-from-browser",
    input.cookiesBrowser,
  ];
  if (
    input.ffmpeg &&
    input.ffmpeg.includes("/") &&
    existsSync(input.ffmpeg)
  ) {
    args.unshift("--ffmpeg-location", dirname(input.ffmpeg));
  }
  return args;
}

type DurationProbeResult =
  | { ok: true; durationSeconds: number }
  | { ok: false; code: YoutubeFetchErrorCode; message: string };

async function probeDurationSeconds(
  runExec: YoutubeExecFile,
  ytdlp: string,
  commonPrefix: string[],
  url: string,
): Promise<DurationProbeResult> {
  const args = [
    ...commonPrefix,
    "--skip-download",
    "--print",
    "%(duration)s",
    url,
  ];
  try {
    const result = await runExec(ytdlp, args, {
      maxBuffer: 2 * 1024 * 1024,
      timeout: YOUTUBE_PROBE_TIMEOUT_MS,
      encoding: "utf8",
    });
    const line = result.stdout
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find((entry) => entry.length > 0);
    if (line === undefined) {
      return {
        ok: false,
        code: "no_duration",
        message: "yt-dlp returned an empty duration",
      };
    }
    const duration = Number(line);
    if (!Number.isFinite(duration) || duration < 0) {
      return {
        ok: false,
        code: "no_duration",
        message: `yt-dlp returned unusable duration: ${line}`,
      };
    }
    return { ok: true, durationSeconds: duration };
  } catch (error) {
    return classifyExecFailure(error);
  }
}

async function tryWriteAutoSubs(
  runExec: YoutubeExecFile,
  ytdlp: string,
  commonPrefix: string[],
  workDir: string,
  url: string,
): Promise<void> {
  const args = [
    ...commonPrefix,
    "--skip-download",
    "--write-auto-subs",
    "--sub-langs",
    YOUTUBE_SUB_LANGS,
    "--convert-subs",
    "srt",
    "-o",
    join(workDir, "%(id)s.%(ext)s"),
    url,
  ];
  try {
    await runExec(ytdlp, args, {
      maxBuffer: 16 * 1024 * 1024,
      timeout: YOUTUBE_SUBS_TIMEOUT_MS,
      encoding: "utf8",
    });
  } catch {
    // Subtitles are optional — leave transcript absent.
  }
}

/** Map yt-dlp spawn failures to typed extract codes (includes stderr). */
export function classifyYtdlpFailure(input: {
  message: string;
  stderr: string;
}): { code: YoutubeFetchErrorCode; message: string } {
  const blob = `${input.message}\n${input.stderr}`;
  const detail = truncateDetail(input.stderr || input.message);
  if (
    /Sign in to confirm you.re not a bot/i.test(blob) ||
    /confirm you.?re not a bot/i.test(blob)
  ) {
    return {
      code: "bot_wall",
      message: `YouTube bot wall (need valid browser YouTube login): ${detail}`,
    };
  }
  if (
    /could not find .* cookies database/i.test(blob) ||
    /cookies are no longer valid/i.test(blob) ||
    /Failed to decrypt with DPAPI/i.test(blob)
  ) {
    return {
      code: "cookies_unavailable",
      message: `YouTube cookies unavailable: ${detail}`,
    };
  }
  return {
    code: "download_failed",
    message: `yt-dlp failed: ${detail}`,
  };
}

function classifyExecFailure(error: unknown): {
  ok: false;
  code: YoutubeFetchErrorCode;
  message: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const stderr =
    error !== null &&
    typeof error === "object" &&
    "stderr" in error &&
    typeof (error as { stderr: unknown }).stderr === "string"
      ? (error as { stderr: string }).stderr
      : "";
  const classified = classifyYtdlpFailure({ message, stderr });
  return { ok: false, ...classified };
}

function truncateDetail(text: string, max = 800): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) {
    return compact;
  }
  return `${compact.slice(0, max)}…`;
}

/**
 * True when basename looks like a yt-dlp intermediate stream fragment
 * (`{id}.f398.mp4`), not a merged output.
 */
export function isYtdlpFragmentFilename(
  filename: string,
  videoId: string,
): boolean {
  const base = basename(filename);
  const escaped = videoId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}\\.f\\d+\\.`, "i").test(base);
}

function isAcceptableVideoFile(path: string, videoId: string): boolean {
  if (!existsSync(path) || !statSync(path).isFile()) {
    return false;
  }
  const ext = extname(path).toLowerCase();
  if (!VIDEO_EXTS.has(ext)) {
    return false;
  }
  if (isYtdlpFragmentFilename(path, videoId)) {
    return false;
  }
  return true;
}

export function findDownloadedVideo(
  workDir: string,
  videoId: string,
  printedPaths: string[],
): string | null {
  for (const printed of printedPaths) {
    if (!printed.includes(workDir) && !printed.startsWith("/")) {
      continue;
    }
    if (isAcceptableVideoFile(printed, videoId)) {
      return printed;
    }
  }

  const entries = readdirSync(workDir);
  const match = entries.find((name) => {
    if (!name.startsWith(videoId)) {
      return false;
    }
    if (isYtdlpFragmentFilename(name, videoId)) {
      return false;
    }
    return VIDEO_EXTS.has(extname(name).toLowerCase());
  });
  return match === undefined ? null : join(workDir, match);
}

function execErrorText(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "stderr" in error &&
    typeof (error as { stderr: unknown }).stderr === "string"
  ) {
    return (error as { stderr: string }).stderr;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Probe whether the file has at least one audio stream.
 * Prefers sibling ffprobe; otherwise parses `ffmpeg -i` stderr for `Audio:`.
 */
export async function probeVideoHasAudio(
  videoPath: string,
  ffmpegBinary: string | null | undefined,
): Promise<boolean> {
  const run = promisify(execFile);
  const ffprobe = resolveFfprobeBesideFfmpeg(ffmpegBinary);
  if (ffprobe !== null) {
    try {
      const { stdout } = await run(
        ffprobe,
        [
          "-v",
          "error",
          "-select_streams",
          "a",
          "-show_entries",
          "stream=codec_type",
          "-of",
          "csv=p=0",
          videoPath,
        ],
        { encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024 },
      );
      return /\baudio\b/i.test(stdout);
    } catch {
      // Fall through to ffmpeg -i.
    }
  }

  const ffmpeg =
    ffmpegBinary && ffmpegBinary.includes("/") && existsSync(ffmpegBinary)
      ? ffmpegBinary
      : "ffmpeg";
  try {
    const result = await run(ffmpeg, ["-hide_banner", "-i", videoPath], {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    // Unusual exit 0 — still inspect stderr/stdout for stream listing.
    return /Audio:\s/i.test(`${result.stderr}\n${result.stdout}`);
  } catch (error) {
    return /Audio:\s/i.test(execErrorText(error));
  }
}

/** Sibling `ffprobe` next to a full-path ffmpeg only; otherwise null → ffmpeg -i. */
export function resolveFfprobeBesideFfmpeg(
  ffmpegBinary: string | null | undefined,
): string | null {
  if (ffmpegBinary && ffmpegBinary.includes("/")) {
    const sibling = join(dirname(ffmpegBinary), "ffprobe");
    if (existsSync(sibling)) {
      return sibling;
    }
  }
  return null;
}

/**
 * Read first available subtitle file; return null when none (explicit absence).
 * Prefer English, then Russian, then any other language file.
 */
export function readTranscriptText(
  workDir: string,
  videoId: string,
): string | null {
  const entries = readdirSync(workDir).filter((name) => {
    if (!name.startsWith(videoId)) {
      return false;
    }
    return SUB_EXTS.has(extname(name).toLowerCase());
  });
  const first = pickPreferredSubtitle(entries);
  if (first === null) {
    return null;
  }
  const raw = readFileSync(join(workDir, first), "utf8");
  const text = stripSubtitleMarkup(raw);
  return text.length > 0 ? text : null;
}

function pickPreferredSubtitle(entries: string[]): string | null {
  if (entries.length === 0) {
    return null;
  }
  const ranked = [...entries].sort((a, b) => {
    const rank = (name: string): number => {
      const lower = name.toLowerCase();
      if (lower.includes(".en.")) return 0;
      if (lower.includes(".ru.")) return 1;
      return 2;
    };
    const diff = rank(a) - rank(b);
    return diff !== 0 ? diff : a.localeCompare(b);
  });
  return ranked[0] ?? null;
}

/** Strip VTT/SRT timing and tags → plain transcript lines. */
export function stripSubtitleMarkup(raw: string): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (
      trimmed === "WEBVTT" ||
      trimmed.startsWith("NOTE") ||
      trimmed.startsWith("Kind:") ||
      trimmed.startsWith("Language:") ||
      /^\d+$/.test(trimmed) ||
      /^\d{2}:\d{2}/.test(trimmed) ||
      /-->/.test(trimmed)
    ) {
      continue;
    }
    const plain = trimmed.replace(/<[^>]+>/g, "").trim();
    if (plain.length === 0 || seen.has(plain)) {
      continue;
    }
    seen.add(plain);
    lines.push(plain);
  }
  return lines.join("\n").trim();
}
