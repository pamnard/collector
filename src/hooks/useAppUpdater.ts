import { useCallback, useState } from "react";
import {
  RELEASES_LATEST_URL,
  type UpdateProgress,
} from "../services/updater-service";

export function useAppUpdater() {
  const [progress, setProgress] = useState<UpdateProgress>({ stage: "idle" });

  const checkForUpdates = useCallback(async () => {
    setProgress({
      stage: "error",
      message:
        `Автообновление убрано (#555). Скачайте новый архив вручную: ${RELEASES_LATEST_URL}`,
    });
  }, []);

  const openReleasesPage = useCallback(() => {
    window.open(RELEASES_LATEST_URL, "_blank", "noopener,noreferrer");
  }, []);

  const installUpdate = useCallback(async () => {
    openReleasesPage();
  }, [openReleasesPage]);

  return {
    progress,
    checkForUpdates,
    installUpdate,
    openReleasesPage,
    hasAvailableUpdate: false,
    releasesUrl: RELEASES_LATEST_URL,
  };
}
