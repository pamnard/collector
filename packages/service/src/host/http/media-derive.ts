/**
 * GET/HEAD `/media/derive` — resize-by-width webp for display slots (#882 / #879).
 * Auth and vault path escape match `/media/file`. Cache lives under dataDir, not the vault.
 */

import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  realpath,
  writeFile,
} from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { CollectorApiError } from "@collector/api";
import {
  isMediaDeriveWhitelistWidth,
  MEDIA_DERIVE_WEBP_QUALITY,
  type MediaDeriveWidth,
} from "@collector/shared";
import sharp from "sharp";
import { isValidHostToken } from "./bearer.js";
import { corsHeadersForRequest } from "./cors.js";
import { isResolvedPathInsideVaults } from "./media-handler.js";
import { writeJson } from "./write-json.js";

export const MEDIA_DERIVE_PATH = "/media/derive";
export const IMAGE_DERIVE_CACHE_DIRNAME = "image-derive-cache";

export type MediaDeriveHandlerOptions = {
  expectedToken: string;
  /** Absolute path to `{dataDir}/vaults` — files must resolve under this root. */
  vaultsRootPath: string;
  /**
   * Optional pre-resolved vaults root (realpath). When set, skips realpath of
   * vaultsRootPath on every request.
   */
  vaultsRootResolved?: string;
  /** Profile dataDir — derive cache is `{dataDir}/image-derive-cache/`. */
  dataDir: string;
  /**
   * Optional encode hook for tests (assert cache hit does not re-encode).
   * Default: sharp resize-by-width → webp at {@link MEDIA_DERIVE_WEBP_QUALITY}.
   */
  encodeWebp?: EncodeDerivedWebp;
};

export type EncodeDerivedWebp = (input: {
  sourcePath: string;
  width: MediaDeriveWidth;
  quality: number;
}) => Promise<Buffer>;

export function isMediaDeriveRequest(
  method: string | undefined,
  pathname: string,
): boolean {
  return (
    (method === "GET" || method === "HEAD") && pathname === MEDIA_DERIVE_PATH
  );
}

export function imageDeriveCacheDir(dataDir: string): string {
  return join(dataDir, IMAGE_DERIVE_CACHE_DIRNAME);
}

/** Stable cache filename from resolved path + mtime + w + quality. */
export function mediaDeriveCacheKey(input: {
  resolvedPath: string;
  mtimeMs: number;
  width: MediaDeriveWidth;
  quality: number;
}): string {
  const hash = createHash("sha256")
    .update(input.resolvedPath)
    .update("\0")
    .update(String(input.mtimeMs))
    .update("\0")
    .update(String(input.width))
    .update("\0")
    .update(String(input.quality))
    .digest("hex");
  return `${hash}.webp`;
}

/** Strong ETag from the disk cache key (hash portion). */
export function mediaDeriveEtag(cacheFileName: string): string {
  const hash = cacheFileName.endsWith(".webp")
    ? cacheFileName.slice(0, -".webp".length)
    : cacheFileName;
  return `"${hash}"`;
}

/**
 * Browser Cache-Control for `/media/derive`.
 * Long max-age only when URL `v` matches source mtime (URL changes on replace).
 * Never `immutable` — stale same-URL responses must remain revalidatable.
 */
export function mediaDeriveBrowserCacheControl(
  urlVersionMatchesSource: boolean,
): string {
  if (urlVersionMatchesSource) {
    return "private, max-age=31536000";
  }
  return "private, max-age=0, must-revalidate";
}

/**
 * Parse optional `v` query (truncated source mtime ms).
 * Absent → null (caller uses short revalidate). Invalid → ok:false for 400.
 */
export function parseMediaDeriveVersionQuery(
  raw: string | null,
):
  | { ok: true; value: number | null }
  | { ok: false; message: string } {
  if (raw === null || raw.length === 0) {
    return { ok: true, value: null };
  }
  if (!/^\d+$/.test(raw)) {
    return { ok: false, message: "v must be a non-negative integer mtime ms" };
  }
  return { ok: true, value: Number(raw) };
}

export async function encodeDerivedWebpDefault(input: {
  sourcePath: string;
  width: MediaDeriveWidth;
  quality: number;
}): Promise<Buffer> {
  return sharp(input.sourcePath)
    .rotate()
    .resize({
      width: input.width,
      withoutEnlargement: true,
    })
    .webp({ quality: input.quality })
    .toBuffer();
}

/**
 * Return cached webp bytes, encoding once on miss.
 * Atomic write: temp file then rename into the cache dir.
 */
export async function readOrCreateDerivedWebp(input: {
  cacheDir: string;
  resolvedPath: string;
  mtimeMs: number;
  width: MediaDeriveWidth;
  quality?: number;
  encodeWebp?: EncodeDerivedWebp;
}): Promise<{ bytes: Buffer; cachePath: string; cacheHit: boolean }> {
  const quality = input.quality ?? MEDIA_DERIVE_WEBP_QUALITY;
  const encode = input.encodeWebp ?? encodeDerivedWebpDefault;
  await mkdir(input.cacheDir, { recursive: true });
  const cachePath = join(
    input.cacheDir,
    mediaDeriveCacheKey({
      resolvedPath: input.resolvedPath,
      mtimeMs: input.mtimeMs,
      width: input.width,
      quality,
    }),
  );

  try {
    const bytes = await readFile(cachePath);
    return { bytes, cachePath, cacheHit: true };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      throw error;
    }
  }

  const bytes = await encode({
    sourcePath: input.resolvedPath,
    width: input.width,
    quality,
  });
  const tmpPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, bytes);
  try {
    await rename(tmpPath, cachePath);
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }
  return { bytes, cachePath, cacheHit: false };
}

export async function handleMediaDerive(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: MediaDeriveHandlerOptions,
): Promise<void> {
  if (!isValidHostToken(req, url, options.expectedToken)) {
    writeJson(req, res, 401, {
      ok: false,
      error: {
        layer: "auth",
        code: "auth_failed",
        message: "media authentication required",
      } satisfies CollectorApiError,
    });
    return;
  }

  const rawPath = url.searchParams.get("path");
  if (rawPath === null || rawPath.length === 0) {
    writeJson(req, res, 400, {
      ok: false,
      error: {
        layer: "validation",
        code: "bad_request",
        message: "path query parameter required",
      } satisfies CollectorApiError,
    });
    return;
  }

  const rawW = url.searchParams.get("w");
  if (rawW === null || rawW.length === 0) {
    writeJson(req, res, 400, {
      ok: false,
      error: {
        layer: "validation",
        code: "bad_request",
        message: "w query parameter required",
      } satisfies CollectorApiError,
    });
    return;
  }
  const widthNum = Number.parseInt(rawW, 10);
  if (
    !Number.isFinite(widthNum) ||
    String(widthNum) !== rawW ||
    !isMediaDeriveWhitelistWidth(widthNum)
  ) {
    writeJson(req, res, 400, {
      ok: false,
      error: {
        layer: "validation",
        code: "bad_request",
        message: "w must be a whitelist width",
      } satisfies CollectorApiError,
    });
    return;
  }
  const width: MediaDeriveWidth = widthNum;

  const parsedVersion = parseMediaDeriveVersionQuery(url.searchParams.get("v"));
  if (!parsedVersion.ok) {
    writeJson(req, res, 400, {
      ok: false,
      error: {
        layer: "validation",
        code: "bad_request",
        message: parsedVersion.message,
      } satisfies CollectorApiError,
    });
    return;
  }
  const requestedVersion = parsedVersion.value;

  let vaultsRootResolved: string;
  if (options.vaultsRootResolved !== undefined) {
    vaultsRootResolved = options.vaultsRootResolved;
  } else {
    try {
      vaultsRootResolved = await realpath(options.vaultsRootPath);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        writeJson(req, res, 404, {
          ok: false,
          error: {
            layer: "domain",
            code: "not_found",
            message: "vaults root not found",
          } satisfies CollectorApiError,
        });
        return;
      }
      throw error;
    }
  }

  let resolvedPath: string;
  try {
    resolvedPath = await realpath(rawPath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      writeJson(req, res, 404, {
        ok: false,
        error: {
          layer: "domain",
          code: "not_found",
          message: "media file not found",
        } satisfies CollectorApiError,
      });
      return;
    }
    throw error;
  }

  if (!isResolvedPathInsideVaults(vaultsRootResolved, resolvedPath)) {
    writeJson(req, res, 403, {
      ok: false,
      error: {
        layer: "auth",
        code: "auth_failed",
        message: "path outside vault",
      } satisfies CollectorApiError,
    });
    return;
  }

  const fileStat = await stat(resolvedPath);
  if (!fileStat.isFile()) {
    writeJson(req, res, 404, {
      ok: false,
      error: {
        layer: "domain",
        code: "not_found",
        message: "media path is not a file",
      } satisfies CollectorApiError,
    });
    return;
  }

  const quality = MEDIA_DERIVE_WEBP_QUALITY;
  const cacheFileName = mediaDeriveCacheKey({
    resolvedPath,
    mtimeMs: fileStat.mtimeMs,
    width,
    quality,
  });
  const etag = mediaDeriveEtag(cacheFileName);
  const urlVersionMatchesSource =
    requestedVersion !== null &&
    requestedVersion === Math.trunc(fileStat.mtimeMs);
  const cacheControl = mediaDeriveBrowserCacheControl(urlVersionMatchesSource);
  const cors = corsHeadersForRequest(req);
  const isHead = req.method === "HEAD";

  const ifNoneMatch = req.headers["if-none-match"];
  if (typeof ifNoneMatch === "string" && ifNoneMatch === etag) {
    res.writeHead(304, {
      etag,
      "cache-control": cacheControl,
      ...cors,
    });
    res.end();
    return;
  }

  const { bytes } = await readOrCreateDerivedWebp({
    cacheDir: imageDeriveCacheDir(options.dataDir),
    resolvedPath,
    mtimeMs: fileStat.mtimeMs,
    width,
    quality,
    encodeWebp: options.encodeWebp,
  });

  const headers: Record<string, string> = {
    "content-type": "image/webp",
    "content-length": String(bytes.byteLength),
    etag,
    "cache-control": cacheControl,
    ...cors,
  };
  res.writeHead(200, headers);
  if (isHead) {
    res.end();
    return;
  }
  res.end(bytes);
}
