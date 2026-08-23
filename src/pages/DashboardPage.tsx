import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useShell } from "../components/layout/AppLayout";
import { DashboardWarmGridShell } from "../components/items/DashboardWarmGridShell";
import { ItemTableView } from "../components/items/ItemTableView";
import {
  useAlerts,
  useDismissAlertsOnUnmount,
} from "../components/alerts/AlertBusProvider";
import { errorMessage } from "../components/alerts/alert-store";
import { collectDroppedFiles } from "../lib/drop-entries";
import { getCollectorService } from "../services/collector-client";
import { isFolderFilter } from "../types/ui";

const DASHBOARD_IMPORT_ID = "dashboard-import";
const DASHBOARD_IMPORT_ERROR_ID = "dashboard-import-error";

/** OS file drops use HTML5 DnD; Tauri windows must set `dragDropEnabled: false`
 * or the shell swallows drops and these handlers never run. */

export function DashboardPage() {
  const {
    viewMode,
    dashboardCache: dashboard,
    activeFilter,
  } = useShell();
  const alerts = useAlerts();
  useDismissAlertsOnUnmount([DASHBOARD_IMPORT_ID, DASHBOARD_IMPORT_ERROR_ID]);
  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const dragDepthRef = useRef(0);

  const targetFolderPath = isFolderFilter(activeFilter)
    ? activeFilter.folderPath
    : undefined;

  useEffect(() => {
    if (isImporting) {
      alerts.upsert(DASHBOARD_IMPORT_ID, {
        tone: "info",
        dismissible: false,
        message: "Импорт файлов…",
      });
    } else {
      alerts.dismiss(DASHBOARD_IMPORT_ID);
    }
  }, [alerts, isImporting]);

  const handleDragEnter = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    if (event.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer.types.includes("Files")) {
      event.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const handleDrop = useCallback(
    async (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = 0;
      setIsDragging(false);

      if (isImporting) {
        return;
      }

      setIsImporting(true);
      alerts.dismiss(DASHBOARD_IMPORT_ERROR_ID);
      try {
        const files = await collectDroppedFiles(event.dataTransfer);
        if (files.length === 0) {
          return;
        }
        await getCollectorService().items.importDroppedFiles({
          folder_path: targetFolderPath,
          files,
        });
        // Presentation events soft-refresh the affected dashboard (#756).
      } catch (err: unknown) {
        alerts.upsert(DASHBOARD_IMPORT_ERROR_ID, {
          tone: "danger",
          message: errorMessage(err),
        });
      } finally {
        setIsImporting(false);
      }
    },
    [alerts, isImporting, targetFolderPath],
  );

  return (
    <DashboardWarmGridShell
      viewMode={viewMode}
      dashboard={dashboard}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {dashboard.totalCount === 0 &&
        !dashboard.error &&
        !dashboard.isLoading && (
          <p className="text-neutral-500 dark:text-neutral-400">
            Ничего не найдено.
          </p>
        )}

      {viewMode === "table" ? (
        <div className="relative z-10">
          <ItemTableView dashboard={dashboard} />
        </div>
      ) : null}

      {isDragging && !isImporting && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-emerald-500/60 bg-emerald-500/10">
          <p className="rounded-lg bg-white/90 px-4 py-2 text-sm text-neutral-900 shadow-xs dark:bg-neutral-800/90 dark:text-neutral-100">
            Отпустите, чтобы импортировать
          </p>
        </div>
      )}
    </DashboardWarmGridShell>
  );
}
