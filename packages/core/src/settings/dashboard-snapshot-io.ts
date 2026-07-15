import {
  DASHBOARD_SNAPSHOT_FILE,
  dashboardSnapshotSchema,
  type DashboardSnapshot,
} from "@collector/shared";
import type { FileSystemAdapter } from "../adapters/types.js";

export function dashboardSnapshotPath(configDir: string): string {
  return configDir.endsWith("/")
    ? `${configDir}${DASHBOARD_SNAPSHOT_FILE}`
    : `${configDir}/${DASHBOARD_SNAPSHOT_FILE}`;
}

export async function readDashboardSnapshot(
  fs: FileSystemAdapter,
  configDir: string,
): Promise<DashboardSnapshot | null> {
  const path = dashboardSnapshotPath(configDir);
  if (!(await fs.exists(path))) {
    return null;
  }

  const raw = await fs.readText(path);
  return dashboardSnapshotSchema.parse(JSON.parse(raw));
}

export async function writeDashboardSnapshot(
  fs: FileSystemAdapter,
  configDir: string,
  snapshot: DashboardSnapshot,
): Promise<void> {
  const parsed = dashboardSnapshotSchema.parse(snapshot);
  await fs.mkdir(configDir);
  await fs.writeText(
    dashboardSnapshotPath(configDir),
    JSON.stringify(parsed, null, 2),
  );
}

export async function clearDashboardSnapshot(
  fs: FileSystemAdapter,
  configDir: string,
): Promise<void> {
  const path = dashboardSnapshotPath(configDir);
  if (await fs.exists(path)) {
    await fs.remove(path);
  }
}
