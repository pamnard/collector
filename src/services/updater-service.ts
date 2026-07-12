import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";

export type UpdateProgress =
  | { stage: "idle" }
  | { stage: "checking" }
  | { stage: "available"; version: string; notes?: string }
  | { stage: "downloading"; downloaded: number; total?: number }
  | { stage: "installing" }
  | { stage: "uptodate" }
  | { stage: "error"; message: string };

export function isUpdaterAvailable(): boolean {
  return isTauri();
}

export async function fetchAvailableUpdate(): Promise<Update | null> {
  if (!isTauri()) {
    return null;
  }

  return check();
}

export async function downloadAndInstallUpdate(
  update: Update,
  onProgress?: (progress: UpdateProgress) => void,
): Promise<void> {
  onProgress?.({ stage: "downloading", downloaded: 0 });

  let downloaded = 0;
  await update.downloadAndInstall((event: DownloadEvent) => {
    switch (event.event) {
      case "Started":
        downloaded = 0;
        onProgress?.({
          stage: "downloading",
          downloaded: 0,
          total: event.data.contentLength ?? undefined,
        });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.({
          stage: "downloading",
          downloaded,
          total: undefined,
        });
        break;
      case "Finished":
        onProgress?.({ stage: "installing" });
        break;
    }
  });

  await relaunch();
}
