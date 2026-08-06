/**
 * Manual update channel via GitHub Releases (#555).
 * In-app auto-updater (Tauri plugin) removed with the desktop shell.
 */

export type UpdateProgress =
  | { stage: "idle" }
  | { stage: "checking" }
  | { stage: "available"; version: string; notes?: string }
  | { stage: "downloading"; downloaded: number; total?: number }
  | { stage: "installing" }
  | { stage: "uptodate" }
  | { stage: "error"; message: string };

export const RELEASES_LATEST_URL =
  "https://github.com/pamnard/collector/releases/latest";

/** No in-app installer after Tauri removal (#555). */
export function isUpdaterAvailable(): boolean {
  return false;
}

export type ManualUpdateInfo = {
  version: string;
  body?: string;
  htmlUrl: string;
};

/** Always null — updates are manual Downloads from GitHub Releases (#555). */
export async function fetchAvailableUpdate(): Promise<ManualUpdateInfo | null> {
  return null;
}

export async function downloadAndInstallUpdate(
  _update: ManualUpdateInfo,
  _onProgress?: (progress: UpdateProgress) => void,
): Promise<void> {
  throw new Error(
    "In-app install removed (#555). Download the latest archive from GitHub Releases.",
  );
}
