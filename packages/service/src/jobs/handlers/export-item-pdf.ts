import type { ExportItemPdfResult } from "@collector/api";
import {
  exportItemPdfIdempotencyKey,
  exportItemPdfJobType,
  type ExportItemPdfJobPayload,
} from "@collector/shared";
import type { BuildItemPrintHtml } from "../../export/build-item-print-document.js";
import {
  exportItemPdfDownloadPath,
  peekExportItemPdfResult,
  storeExportItemPdf,
  takeExportItemPdfResult,
} from "../../export/export-item-pdf-store.js";
import type { HtmlToPdf } from "../../export/html-to-pdf.js";
import type { JobQueue, EnqueueResult } from "../job-queue.js";
import type { TypedJobHandler } from "../job-registry.js";
import type { JobHandlerResult } from "../job-types.js";

export { peekExportItemPdfResult, takeExportItemPdfResult };

export function toExportItemPdfResult(
  jobId: string,
): ExportItemPdfResult | null {
  const stored = peekExportItemPdfResult(jobId);
  if (!stored) {
    return null;
  }
  return {
    filename: stored.filename,
    downloadPath: exportItemPdfDownloadPath(jobId),
  };
}

export function createExportItemPdfHandler(deps: {
  buildItemPrintHtml: BuildItemPrintHtml;
  htmlToPdf: HtmlToPdf;
  assertActiveVault: (vaultId: string) => Promise<void>;
  /** Fail loudly before print work when Chromium/Playwright cannot launch. */
  assertPdfEngineReady: () => Promise<void>;
}): TypedJobHandler<typeof exportItemPdfJobType.payload> {
  return async (job): Promise<JobHandlerResult> => {
    await deps.assertActiveVault(job.payload.vaultId);

    try {
      await deps.assertPdfEngineReady();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: "fail",
        retryable: false,
        error: message,
      };
    }

    let html: string;
    let filename: string;
    try {
      const built = await deps.buildItemPrintHtml(job.payload.itemId);
      html = built.html;
      filename = built.filename;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: "fail",
        retryable: false,
        error: message,
      };
    }

    let pdfBytes: Uint8Array;
    try {
      pdfBytes = await deps.htmlToPdf(html);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: "fail",
        retryable: false,
        error: `htmlToPdf failed: ${message}`,
      };
    }

    if (pdfBytes.byteLength === 0) {
      return {
        status: "fail",
        retryable: false,
        error: "htmlToPdf returned empty PDF",
      };
    }

    await storeExportItemPdf(job.id, filename, pdfBytes);
    return { status: "ok" };
  };
}

export function enqueueExportItemPdf(
  queue: JobQueue,
  payload: ExportItemPdfJobPayload,
): Promise<EnqueueResult> {
  if (exportItemPdfJobType.maxAttempts === undefined) {
    throw new Error("exportItemPdf job type must declare maxAttempts");
  }
  return queue.enqueue({
    type: "exportItemPdf",
    payload,
    maxAttempts: exportItemPdfJobType.maxAttempts,
    idempotencyKey: exportItemPdfIdempotencyKey(payload),
  });
}
