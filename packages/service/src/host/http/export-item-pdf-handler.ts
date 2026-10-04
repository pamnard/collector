/**
 * GET/HEAD /export/item-pdf — stream a completed item PDF (#304).
 * Auth: query `token` or Authorization Bearer (same host token as /media/file).
 */

import { createReadStream } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CollectorApiError } from "@collector/api";
import {
  peekExportItemPdfResult,
  takeExportItemPdfResult,
} from "../../export/export-item-pdf-store.js";
import { isValidHostToken } from "./bearer.js";
import { corsHeadersForRequest } from "./cors.js";
import { writeJson } from "./write-json.js";

export const EXPORT_ITEM_PDF_PATH = "/export/item-pdf";

export function isExportItemPdfRequest(
  method: string | undefined,
  pathname: string,
): boolean {
  return (
    (method === "GET" || method === "HEAD") && pathname === EXPORT_ITEM_PDF_PATH
  );
}

export async function handleExportItemPdf(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: { expectedToken: string },
): Promise<void> {
  if (!isValidHostToken(req, url, options.expectedToken)) {
    writeJson(req, res, 401, {
      ok: false,
      error: {
        layer: "auth",
        code: "auth_failed",
        message: "export authentication required",
      } satisfies CollectorApiError,
    });
    return;
  }

  const jobId = url.searchParams.get("jobId");
  if (jobId === null || jobId.trim().length === 0) {
    writeJson(req, res, 400, {
      ok: false,
      error: {
        layer: "validation",
        code: "bad_request",
        message: "jobId query parameter required",
      } satisfies CollectorApiError,
    });
    return;
  }

  const stored = peekExportItemPdfResult(jobId);
  if (!stored) {
    writeJson(req, res, 404, {
      ok: false,
      error: {
        layer: "domain",
        code: "not_found",
        message: "export PDF not found or expired",
      } satisfies CollectorApiError,
    });
    return;
  }

  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(stored.absolutePath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      takeExportItemPdfResult(jobId);
      writeJson(req, res, 404, {
        ok: false,
        error: {
          layer: "domain",
          code: "not_found",
          message: "export PDF file missing",
        } satisfies CollectorApiError,
      });
      return;
    }
    throw error;
  }

  if (!fileStat.isFile() || fileStat.size === 0) {
    takeExportItemPdfResult(jobId);
    writeJson(req, res, 500, {
      ok: false,
      error: {
        layer: "domain",
        code: "failed",
        message: "export PDF is empty or not a file",
      } satisfies CollectorApiError,
    });
    return;
  }

  const cors = corsHeadersForRequest(req);
  const headers: Record<string, string> = {
    "content-type": "application/pdf",
    "content-length": String(fileStat.size),
    "content-disposition": `attachment; filename="${stored.filename.replace(/"/g, "")}"`,
    "cache-control": "no-store",
    ...cors,
  };
  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }

  const absolutePath = stored.absolutePath;
  const stream = createReadStream(absolutePath);
  stream.on("error", (streamError) => {
    console.error("[export-item-pdf] stream error", {
      jobId,
      path: absolutePath,
      error: streamError,
    });
    if (!res.writableEnded) {
      res.destroy(streamError);
    }
  });
  stream.on("end", () => {
    takeExportItemPdfResult(jobId);
    void unlink(absolutePath).catch((unlinkError: unknown) => {
      console.error("[export-item-pdf] unlink failed after download", {
        jobId,
        path: absolutePath,
        error: unlinkError,
      });
    });
  });
  stream.pipe(res);
}
