/**
 * GET/HEAD /media/file — stream vault media for browser UI (#553).
 * Auth: query `token` or Authorization Bearer (same host token as /api/rpc).
 */

import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname } from "node:path";
import type { CollectorApiError } from "@collector/api";
import { isValidHostToken } from "./bearer.js";
import { corsHeadersForRequest } from "./cors.js";
import { writeJson } from "./write-json.js";

const MEDIA_PATH = "/media/file";

const CONTENT_TYPES: Record<string, string> = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
};

export type MediaHandlerOptions = {
  expectedToken: string;
  /** Absolute path to `{dataDir}/vaults` — files must resolve under this root. */
  vaultsRootPath: string;
  /**
   * Optional pre-resolved vaults root (realpath). When set, skips realpath of
   * vaultsRootPath on every request (#550 cleanup B).
   */
  vaultsRootResolved?: string;
};

export function contentTypeForPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** True when `resolvedPath` is strictly inside `vaultsRootPath` (file, not the root itself). */
export function isResolvedPathInsideVaults(
  vaultsRootPath: string,
  resolvedPath: string,
): boolean {
  const root = vaultsRootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const target = resolvedPath.replace(/\\/g, "/");
  const prefix = `${root}/`;
  return target.startsWith(prefix) && target.length > prefix.length;
}

export function isMediaFileRequest(
  method: string | undefined,
  pathname: string,
): boolean {
  return (
    (method === "GET" || method === "HEAD") && pathname === MEDIA_PATH
  );
}

export type ParsedByteRange = {
  start: number;
  end: number;
};

/**
 * Parse a single `bytes=start-end` Range. Returns null when absent or unsatisfiable
 * against `size` (caller may ignore and send full body, or 416).
 */
export function parseByteRange(
  rangeHeader: string | undefined,
  size: number,
): ParsedByteRange | null {
  if (!rangeHeader || size <= 0) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) {
    return null;
  }
  const startRaw = match[1]!;
  const endRaw = match[2]!;
  if (startRaw === "" && endRaw === "") {
    return null;
  }
  let start: number;
  let end: number;
  if (startRaw === "") {
    // suffix: last N bytes
    const suffix = Number.parseInt(endRaw, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) {
      return null;
    }
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number.parseInt(startRaw, 10);
    end =
      endRaw === "" ? size - 1 : Number.parseInt(endRaw, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return null;
    }
  }
  if (start < 0 || end < start || start >= size) {
    return null;
  }
  end = Math.min(end, size - 1);
  return { start, end };
}

/**
 * Serve vault media for an authenticated GET/HEAD /media/file request.
 */
export async function handleMediaFile(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: MediaHandlerOptions,
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

  const size = fileStat.size;
  const contentType = contentTypeForPath(resolvedPath);
  const cors = corsHeadersForRequest(req);
  const isHead = req.method === "HEAD";
  const range = parseByteRange(
    typeof req.headers.range === "string" ? req.headers.range : undefined,
    size,
  );

  if (range) {
    const length = range.end - range.start + 1;
    const headers: Record<string, string> = {
      "content-type": contentType,
      "content-length": String(length),
      "accept-ranges": "bytes",
      "content-range": `bytes ${range.start}-${range.end}/${size}`,
      ...cors,
    };
    res.writeHead(206, headers);
    if (isHead) {
      res.end();
      return;
    }
    const stream = createReadStream(resolvedPath, {
      start: range.start,
      end: range.end,
    });
    stream.on("error", (streamError) => {
      console.error("[media-handler] stream error", {
        path: resolvedPath,
        error: streamError,
      });
      if (!res.writableEnded) {
        res.destroy(streamError);
      }
    });
    stream.pipe(res);
    return;
  }

  const headers: Record<string, string> = {
    "content-type": contentType,
    "content-length": String(size),
    "accept-ranges": "bytes",
    ...cors,
  };
  res.writeHead(200, headers);
  if (isHead) {
    res.end();
    return;
  }
  const stream = createReadStream(resolvedPath);
  stream.on("error", (streamError) => {
    console.error("[media-handler] stream error", {
      path: resolvedPath,
      error: streamError,
    });
    if (!res.writableEnded) {
      res.destroy(streamError);
    }
  });
  stream.pipe(res);
}
