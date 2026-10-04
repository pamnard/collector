/**
 * Temp-file store for completed item PDF exports (#304).
 * Job RPC snapshots only expose downloadPath — never base64 PDF bytes.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createJobResultMailbox } from "../jobs/job-result-mailbox.js";

export type StoredExportItemPdf = {
  filename: string;
  absolutePath: string;
};

const exportResults = createJobResultMailbox<StoredExportItemPdf>({
  ttlMs: 10 * 60 * 1000,
});

let exportsDir: string | null = null;

export function configureExportItemPdfStore(dataDir: string): void {
  exportsDir = join(dataDir, "export-item-pdf");
}

async function requireExportsDir(): Promise<string> {
  if (!exportsDir) {
    throw new Error("export item PDF store is not configured (dataDir)");
  }
  await mkdir(exportsDir, { recursive: true });
  return exportsDir;
}

export async function storeExportItemPdf(
  jobId: string,
  filename: string,
  pdfBytes: Uint8Array,
): Promise<StoredExportItemPdf> {
  const dir = await requireExportsDir();
  const absolutePath = join(dir, `${jobId}.pdf`);
  await writeFile(absolutePath, pdfBytes);
  const stored = { filename, absolutePath };
  exportResults.set(jobId, stored);
  return stored;
}

export function peekExportItemPdfResult(
  jobId: string,
): StoredExportItemPdf | null {
  return exportResults.peek(jobId);
}

export function takeExportItemPdfResult(
  jobId: string,
): StoredExportItemPdf | null {
  return exportResults.take(jobId);
}

/** Relative host path the UI fetches after the job succeeds. */
export function exportItemPdfDownloadPath(jobId: string): string {
  return `/export/item-pdf?jobId=${encodeURIComponent(jobId)}`;
}
