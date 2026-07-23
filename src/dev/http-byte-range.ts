/**
 * HTTP byte-range resolution (RFC 7233) for single-range media seeks.
 */

import { createReadStream } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

export type ByteRangeResult =
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "unsatisfiable" };

/**
 * Resolve a `Range` request header against a resource size.
 * Multi-range and malformed headers → `full` (serve whole file).
 * Inclusive `end` for Node `createReadStream({ start, end })`.
 */
export function resolveByteRange(
  rangeHeader: string | undefined,
  size: number,
): ByteRangeResult {
  if (rangeHeader === undefined) {
    return { kind: "full" };
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) {
    return { kind: "full" };
  }

  const startRaw = match[1];
  const endRaw = match[2];

  if (startRaw === "" && endRaw === "") {
    return { kind: "full" };
  }

  // suffix: bytes=-N
  if (startRaw === "") {
    const suffixLen = Number(endRaw);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) {
      return { kind: "full" };
    }
    if (size === 0) {
      return { kind: "unsatisfiable" };
    }
    const start = Math.max(0, size - suffixLen);
    return { kind: "partial", start, end: size - 1 };
  }

  const start = Number(startRaw);
  if (!Number.isFinite(start) || start < 0) {
    return { kind: "full" };
  }

  if (size === 0 || start >= size) {
    return { kind: "unsatisfiable" };
  }

  // open-ended: bytes=start-
  if (endRaw === "") {
    return { kind: "partial", start, end: size - 1 };
  }

  const endParsed = Number(endRaw);
  if (!Number.isFinite(endParsed) || endParsed < start) {
    return { kind: "full" };
  }

  const end = Math.min(endParsed, size - 1);
  return { kind: "partial", start, end };
}

/**
 * Stream a local file with Accept-Ranges / optional 206 Partial Content.
 */
export function sendFileWithByteRange(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
  size: number,
  mime: string,
): void {
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", mime);

  const rangeHeader = req.headers.range;
  const range = resolveByteRange(
    typeof rangeHeader === "string" ? rangeHeader : undefined,
    size,
  );

  if (range.kind === "unsatisfiable") {
    res.statusCode = 416;
    res.setHeader("Content-Range", `bytes */${size}`);
    res.end();
    return;
  }

  if (range.kind === "partial") {
    const { start, end } = range;
    const length = end - start + 1;
    res.statusCode = 206;
    res.setHeader("Content-Length", String(length));
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Length", String(size));
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}
