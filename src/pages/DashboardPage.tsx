import { useCallback, useRef, useState, type DragEvent } from "react";
import { useShell } from "../components/layout/AppLayout";
import { ItemGridView } from "../components/items/ItemGridView";
import { ItemTableView } from "../components/items/ItemTableView";
import { Alert } from "../components/alerts/Alert";
import { AlertStack } from "../components/alerts/AlertStack";
import { collectDroppedFiles } from "../lib/drop-entries";
import { getCollectorClient } from "../services/collector-client";
import { isFolderFilter } from "../types/ui";

export function DashboardPage() {
  const {
    viewMode,
    refreshVault,
    dashboardCache: dashboard,
    activeFilter,
  } = useShell();
  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const dragDepthRef = useRef(0);

  const targetFolderPath = isFolderFilter(activeFilter)
    ? activeFilter.folderPath
    : undefined;

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
      setImportError(null);
      try {
        const files = await collectDroppedFiles(event.dataTransfer);
        if (files.length === 0) {
          return;
        }
        await getCollectorClient().importDroppedFiles({
          folder_path: targetFolderPath,
          files,
        });
        refreshVault();
      } catch (err: unknown) {
        setImportError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsImporting(false);
      }
    },
    [isImporting, refreshVault, targetFolderPath],
  );

  return (
    <div
      className="relative pb-20 min-h-full"
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

      {viewMode === "grid" ? (
        <ItemGridView dashboard={dashboard} />
      ) : (
        <ItemTableView dashboard={dashboard} onUpdated={refreshVault} />
      )}

      {(isDragging || isImporting) && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-emerald-500/60 bg-emerald-500/10">
          <p className="rounded-lg bg-white/90 px-4 py-2 text-sm text-neutral-900 shadow-sm dark:bg-neutral-800/90 dark:text-neutral-100">
            {isImporting
              ? "Импорт…"
              : "Отпустите, чтобы импортировать"}
          </p>
        </div>
      )}

      {(importError || isImporting) && (
        <AlertStack>
          {isImporting && (
            <Alert tone="info">Импорт файлов…</Alert>
          )}
          {importError && (
            <Alert tone="danger" onDismiss={() => setImportError(null)}>
              {importError}
            </Alert>
          )}
        </AlertStack>
      )}
    </div>
  );
}
