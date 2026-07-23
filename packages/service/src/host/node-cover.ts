/**
 * Node domain-host cover generation (#255 / #267).
 * Browser path uses canvas in `src/services/thumbnail-service.ts`.
 *
 * Video seek matches browser: min(0.5s, duration/2), else 0.
 */

import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { MediaType } from "@collector/shared";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

const COVER_MAX_EDGE = 480;
const COVER_WEBP_QUALITY = 85;

const DURATION_RE = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/;

function moduleDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/**
 * Resolve ffmpeg binary: COLLECTOR_FFMPEG → bundled host bin/ → PATH name.
 */
export function resolveFfmpegBinary(): string | null {
  const fromEnv = process.env.COLLECTOR_FFMPEG?.trim();
  if (fromEnv) {
    return existsSync(fromEnv) ? fromEnv : null;
  }

  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const bundledCandidates = [
    // Packaged host: resources/collector-service-host/bin/ffmpeg (cli.js sibling)
    join(moduleDir(), "bin", exe),
    // Dev: monorepo packaged resources (after prepare:service-host-resources)
    join(
      moduleDir(),
      "..",
      "..",
      "..",
      "..",
      "src-tauri",
      "resources",
      "collector-service-host",
      "bin",
      exe,
    ),
  ];

  for (const candidate of bundledCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return exe;
}

function parseDurationSeconds(ffmpegStderr: string): number | null {
  const match = DURATION_RE.exec(ffmpegStderr);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (![hours, minutes, seconds].every(Number.isFinite)) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

/** Same seek policy as `src/services/thumbnail-service.ts`. */
export function seekTargetSeconds(duration: number | null): number {
  if (duration !== null && Number.isFinite(duration) && duration > 0) {
    return Math.min(0.5, duration / 2);
  }
  return 0;
}

async function probeDurationSeconds(
  ffmpegBin: string,
  inputPath: string,
): Promise<number | null> {
  try {
    await execFileAsync(ffmpegBin, ["-hide_banner", "-i", inputPath], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    });
    return null;
  } catch (error) {
    // ffmpeg -i with no output exits non-zero; Duration is on stderr.
    const err = error as { stderr?: string };
    return parseDurationSeconds(err.stderr ?? "");
  }
}

async function extractVideoFramePng(
  ffmpegBin: string,
  inputPath: string,
  outputPngPath: string,
  seekSeconds: number,
): Promise<void> {
  await execFileAsync(
    ffmpegBin,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(seekSeconds),
      "-i",
      inputPath,
      "-frames:v",
      "1",
      "-y",
      outputPngPath,
    ],
    { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
  );
}

async function imageBytesToCoverWebp(data: Uint8Array): Promise<Uint8Array> {
  const buffer = await sharp(Buffer.from(data))
    .rotate()
    .resize({
      width: COVER_MAX_EDGE,
      height: COVER_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: COVER_WEBP_QUALITY })
    .toBuffer();

  return new Uint8Array(buffer);
}

async function generateCoverFromVideo(
  data: Uint8Array,
  filename: string,
): Promise<Uint8Array | null> {
  const ffmpegBin = resolveFfmpegBinary();
  if (!ffmpegBin) {
    return null;
  }

  const ext = extname(filename).toLowerCase() || ".mp4";
  const dir = mkdtempSync(join(tmpdir(), "collector-video-cover-"));
  const inputPath = join(dir, `input${ext}`);
  const framePath = join(dir, "frame.png");

  try {
    writeFileSync(inputPath, data);

    try {
      await execFileAsync(ffmpegBin, ["-version"], {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      });
    } catch {
      // Missing binary / not on PATH — soft-fail like browser decode miss.
      return null;
    }

    const duration = await probeDurationSeconds(ffmpegBin, inputPath);
    const seek = seekTargetSeconds(duration);
    await extractVideoFramePng(ffmpegBin, inputPath, framePath, seek);

    const frame = readFileSync(framePath);
    return imageBytesToCoverWebp(new Uint8Array(frame));
  } catch {
    // Decode / seek / encode failure — soft-fail like browser path.
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function generateCoverFromMedia(
  data: Uint8Array,
  filename: string,
  mediaType: MediaType,
): Promise<Uint8Array | null> {
  if (mediaType === "image") {
    return imageBytesToCoverWebp(data);
  }

  if (mediaType === "video") {
    return generateCoverFromVideo(data, filename);
  }

  return null;
}
