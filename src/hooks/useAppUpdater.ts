import { useCallback, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import {
  downloadAndInstallUpdate,
  fetchAvailableUpdate,
  isUpdaterAvailable,
  type UpdateProgress,
} from "../services/updater-service";

export function useAppUpdater() {
  const [progress, setProgress] = useState<UpdateProgress>({ stage: "idle" });
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);

  const checkForUpdates = useCallback(async () => {
    if (!isUpdaterAvailable()) {
      setProgress({
        stage: "error",
        message: "Обновления доступны только в установленной desktop-версии.",
      });
      return;
    }

    setProgress({ stage: "checking" });
    setAvailableUpdate(null);

    try {
      const update = await fetchAvailableUpdate();
      if (!update) {
        setProgress({ stage: "uptodate" });
        return;
      }

      setAvailableUpdate(update);
      setProgress({
        stage: "available",
        version: update.version,
        notes: update.body ?? undefined,
      });
    } catch (err: unknown) {
      setProgress({
        stage: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const installUpdate = useCallback(async () => {
    if (!availableUpdate) {
      return;
    }

    try {
      await downloadAndInstallUpdate(availableUpdate, setProgress);
    } catch (err: unknown) {
      setProgress({
        stage: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [availableUpdate]);

  return {
    progress,
    checkForUpdates,
    installUpdate,
    hasAvailableUpdate: availableUpdate !== null,
  };
}
