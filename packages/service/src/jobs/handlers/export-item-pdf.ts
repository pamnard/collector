import type { ExportItemPdfResult } from "@collector/api";
import {
  exportItemPdfIdempotencyKey,
  exportItemPdfJobType,
  type ExportItemPdfJobPayload,
} from "@collector/shared";
import type { BuildItemPrintHtml } from "../../export/build-item-print-document.js";
import type { HtmlToPdf } from "../../export/html-to-pdf.js";
import type { JobQueue, EnqueueResult } from "../job-queue.js";
import type { TypedJobHandler } from "../job-registry.js";
import type { JobHandlerResult } from "../job-types.js";
import { createJobResultMailbox } from "../job-result-mailbox.js";

const exportResults = createJobResultMailbox<ExportItemPdfResult>({
  ttlMs: 10 * 60 * 1000,
});

export function takeExportItemPdfResult(
  jobId: string,
): ExportItemPdfResult | null {
  return exportResults.take(jobId);
}

export function peekExportItemPdfResult(
  jobId: string,
): ExportItemPdfResult | null {
  return exportResults.peek(jobId);
}

export function createExportItemPdfHandler(deps: {
  buildItemPrintHtml: BuildItemPrintHtml;
  htmlToPdf: HtmlToPdf;
  assertActiveVault: (vaultId: string) => Promise<void>;
}): TypedJobHandler<typeof exportItemPdfJobType.payload> {
  return async (job): Promise<JobHandlerResult> => {
    await deps.assertActiveVault(job.payload.vaultId);
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

    exportResults.set(job.id, {
      filename,
      pdfBase64: Buffer.from(pdfBytes).toString("base64"),
    });
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
