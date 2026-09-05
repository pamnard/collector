/**
 * Node domain-host cover generation (#255 / #267).
 * Browser path uses canvas in `src/services/thumbnail-service.ts`.
 *
 * Video cover seek: 5% of duration (shared `@collector/shared` policy).
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
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { GeneratedCover, MediaType } from "@collector/shared";
import {
  COVER_WEBP_MAX_EDGE,
  coverPixelSizeSchema,
  seekTargetSeconds,
} from "@collector/shared";
import sharp from "sharp";

export { seekTargetSeconds };

const execFileAsync = promisify(execFile);

const COVER_MAX_EDGE = COVER_WEBP_MAX_EDGE;
const COVER_WEBP_QUALITY = 85;

const DURATION_RE = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/;

/**
 * Host directory for bundled `bin/ffmpeg` (ESM source + CJS packaged host).
 * Packaged esbuild CJS can leave `import.meta.url` undefined (#441).
 */
export function resolveServiceHostDir(input: {
  metaUrl?: string;
  argv1?: string | undefined;
  execPath: string;
}): string {
  const metaUrl = input.metaUrl;
  if (typeof metaUrl === "string" && metaUrl.length > 0) {
    return dirname(fileURLToPath(metaUrl));
  }
  if (typeof input.argv1 === "string" && input.argv1.length > 0) {
    return dirname(resolve(input.argv1));
  }
  return dirname(input.execPath);
}

function moduleDir(): string {
  return resolveServiceHostDir({
    metaUrl: import.meta.url,
    argv1: process.argv[1],
    execPath: process.execPath,
  });
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
    // Packaged host: collector-service-host/bin/ffmpeg (cli.js sibling)
    join(moduleDir(), "bin", exe),
    // Dev: release staging after prepare-service-host-resources (#555)
    join(
      moduleDir(),
      "..",
      "..",
      "..",
      "..",
      "dist",
      "collector-release",
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

async function imageBytesToCoverWebp(data: Uint8Array): Promise<GeneratedCover> {
  const { data: buffer, info } = await sharp(Buffer.from(data))
    .rotate()
    .resize({
      width: COVER_MAX_EDGE,
      height: COVER_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: COVER_WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true });

  return {
    data: new Uint8Array(buffer),
    size: coverPixelSizeSchema.parse({
      width: info.width,
      height: info.height,
    }),
  };
}

async function ensureFfmpegRunnable(
  ffmpegBin: string,
  filename: string,
): Promise<boolean> {
  try {
    await execFileAsync(ffmpegBin, ["-version"], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return true;
  } catch {
    console.error("[node-cover] video cover soft-fail: ffmpeg -version failed", {
      filename,
      ffmpegBin,
    });
    return false;
  }
}

/**
 * Extract cover from a video already on disk (no heap buffer of the whole file).
 */
export async function generateCoverFromVideoPath(
  inputPath: string,
  filename: string,
): Promise<GeneratedCover | null> {
  const ffmpegBin = resolveFfmpegBinary();
  if (!ffmpegBin) {
    console.error("[node-cover] video cover soft-fail: ffmpeg binary not resolved", {
      filename,
    });
    return null;
  }

  if (!(await ensureFfmpegRunnable(ffmpegBin, filename))) {
    return null;
  }

  const dir = mkdtempSync(join(tmpdir(), "collector-video-cover-"));
  const framePath = join(dir, "frame.png");
  try {
    const duration = await probeDurationSeconds(ffmpegBin, inputPath);
    const seek = seekTargetSeconds(duration);
    await extractVideoFramePng(ffmpegBin, inputPath, framePath, seek);
    const frame = readFileSync(framePath);
    return imageBytesToCoverWebp(new Uint8Array(frame));
  } catch (error) {
    console.error("[node-cover] video cover soft-fail: decode/seek/encode", {
      filename,
      ffmpegBin,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function generateCoverFromVideo(
  data: Uint8Array,
  filename: string,
): Promise<GeneratedCover | null> {
  const ext = extname(filename).toLowerCase() || ".mp4";
  const dir = mkdtempSync(join(tmpdir(), "collector-video-cover-buf-"));
  const inputPath = join(dir, `input${ext}`);
  try {
    writeFileSync(inputPath, data);
    return await generateCoverFromVideoPath(inputPath, filename);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function generateCoverFromMedia(
  data: Uint8Array,
  filename: string,
  mediaType: MediaType,
): Promise<GeneratedCover | null> {
  if (mediaType === "image") {
    return imageBytesToCoverWebp(data);
  }

  if (mediaType === "video") {
    return generateCoverFromVideo(data, filename);
  }

  return null;
}

export async function generateCoverFromMediaPath(
  absolutePath: string,
  filename: string,
  mediaType: MediaType,
): Promise<GeneratedCover | null> {
  if (mediaType === "image") {
    const data = new Uint8Array(readFileSync(absolutePath));
    return imageBytesToCoverWebp(data);
  }

  if (mediaType === "video") {
    return generateCoverFromVideoPath(absolutePath, filename);
  }

  return null;
}
