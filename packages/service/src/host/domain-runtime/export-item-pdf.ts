import type { ExportItemPdfJobSnapshot } from "@collector/api";
import type { JobQueue } from "../../jobs/job-queue.js";
import {
  enqueueExportItemPdf,
  toExportItemPdfResult,
} from "../../jobs/handlers/export-item-pdf.js";

export interface ExportItemPdfRuntimeDeps {
  resolveActiveVault: () => Promise<{ vault: { id: string } }>;
  requireJobs: () => JobQueue;
}

export function createExportItemPdfRuntime(deps: ExportItemPdfRuntimeDeps) {
  return {
    async exportItemPdf(itemId: string): Promise<{ jobId: string }> {
      const trimmed = itemId.trim();
      if (!trimmed) {
        throw new Error("exportItemPdf itemId must be non-empty");
      }
      const active = await deps.resolveActiveVault();
      const { id } = await enqueueExportItemPdf(deps.requireJobs(), {
        vaultId: active.vault.id,
        itemId: trimmed,
      });
      return { jobId: id };
    },

    async getExportItemPdfJob(jobId: string): Promise<ExportItemPdfJobSnapshot> {
      const row = await deps.requireJobs().getJob(jobId);
      if (!row) {
        throw new Error(`exportItemPdf job not found: ${jobId}`);
      }
      return {
        jobId,
        status: row.status as ExportItemPdfJobSnapshot["status"],
        result: toExportItemPdfResult(jobId),
        error: row.last_error,
      };
    },
  };
}
