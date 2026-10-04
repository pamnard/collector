import type { AlertsApi } from "../components/alerts/alert-store";
import { getCollectorService } from "../services/collector-client";

export const ITEM_EXPORT_PDF_SUCCESS_ID = "item-export-pdf-success";
export const ITEM_EXPORT_PDF_ENQUEUE_ERROR_ID = "item-export-pdf-enqueue-error";

const activeWaits = new Set<string>();

function triggerBrowserDownload(filename: string, bytes: Uint8Array): void {
  const copy = new Uint8Array(bytes);
  const blob = new Blob([copy], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function waitAndDownload(
  jobId: string,
  alerts: Pick<AlertsApi, "upsert">,
): Promise<void> {
  if (activeWaits.has(jobId)) {
    return;
  }
  activeWaits.add(jobId);
  try {
    const startedAt = Date.now();
    let delayMs = 50;
    while (Date.now() - startedAt < 5 * 60 * 1000) {
      const snap = await getCollectorService().items.getExportItemPdfJob(jobId);
      if (
        snap.status === "pending" ||
        snap.status === "running"
      ) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs = Math.min(delayMs * 2, 500);
        continue;
      }
      if (snap.status === "succeeded" && snap.result) {
        const binary = atob(snap.result.pdfBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        triggerBrowserDownload(snap.result.filename, bytes);
        alerts.upsert(ITEM_EXPORT_PDF_SUCCESS_ID, {
          tone: "info",
          dismissible: true,
          message: "PDF готов",
        });
        return;
      }
      // Permanent failures are surfaced by the global job AlertStack path.
      return;
    }
    console.error("[exportItemPdf] wait timed out", { jobId });
    alerts.upsert(ITEM_EXPORT_PDF_ENQUEUE_ERROR_ID, {
      tone: "danger",
      dismissible: true,
      message: "Экспорт в PDF не завершился вовремя",
      detail: `jobId=${jobId}`,
    });
  } finally {
    activeWaits.delete(jobId);
  }
}

/**
 * Enqueue host PDF export and return immediately (#304).
 * Download runs in a module-level waiter so navigation stays free.
 */
export async function enqueueItemPdfExport(
  alerts: Pick<AlertsApi, "upsert">,
  itemId: string,
): Promise<void> {
  try {
    const { jobId } = await getCollectorService().items.exportItemPdf(itemId);
    void waitAndDownload(jobId, alerts);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[exportItemPdf] enqueue failed", { itemId, error });
    alerts.upsert(ITEM_EXPORT_PDF_ENQUEUE_ERROR_ID, {
      tone: "danger",
      dismissible: true,
      message: "Не удалось начать экспорт в PDF",
      detail,
    });
  }
}
