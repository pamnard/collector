import { appConfigDir, join } from "@tauri-apps/api/path";
import {
  dashboardSnapshotMatchesQuery,
  dashboardSnapshotSchema,
  type DashboardSnapshot,
} from "@collector/shared";
import {
  clearDashboardSnapshot as clearDashboardSnapshotFile,
  readDashboardSnapshot,
  writeDashboardSnapshot,
} from "@collector/core";
import { TauriFileSystemAdapter } from "../adapters/tauri-fs";
import { isDevMock } from "../dev/is-dev-mock";
import type { NavFilter } from "../types/ui";
import { navFilterToSetting } from "../types/ui";

const DEV_MOCK_SNAPSHOT_KEY = "collector-dev-mock-dashboard-snapshot";

let configDir = "";
let cache: DashboardSnapshot | null = null;
let cacheLoaded = false;
const fs = new TauriFileSystemAdapter();

async function ensureConfigDir(): Promise<string> {
  if (!configDir) {
    configDir = await join(await appConfigDir(), "collector");
  }
  return configDir;
}

function readDevMockSnapshot(): DashboardSnapshot | null {
  const raw = localStorage.getItem(DEV_MOCK_SNAPSHOT_KEY);
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as DashboardSnapshot;
}

function writeDevMockSnapshot(snapshot: DashboardSnapshot | null): void {
  if (!snapshot) {
    localStorage.removeItem(DEV_MOCK_SNAPSHOT_KEY);
    return;
  }
  localStorage.setItem(DEV_MOCK_SNAPSHOT_KEY, JSON.stringify(snapshot));
}

export async function ensureDashboardSnapshot(): Promise<DashboardSnapshot | null> {
  if (cacheLoaded) {
    return cache;
  }

  if (isDevMock()) {
    cache = readDevMockSnapshot();
    cacheLoaded = true;
    return cache;
  }

  cache = await readDashboardSnapshot(fs, await ensureConfigDir());
  cacheLoaded = true;
  return cache;
}

export function peekMatchingDashboardSnapshot(
  vaultId: string,
  filter: NavFilter,
  search: string,
): DashboardSnapshot | null {
  if (!cacheLoaded || !cache) {
    return null;
  }

  if (
    !dashboardSnapshotMatchesQuery(cache, {
      vaultId,
      navFilter: navFilterToSetting(filter),
      search,
    })
  ) {
    return null;
  }

  return cache;
}

export async function persistDashboardSnapshot(
  snapshot: DashboardSnapshot,
): Promise<void> {
  cache = snapshot;
  cacheLoaded = true;

  if (isDevMock()) {
    writeDevMockSnapshot(snapshot);
    return;
  }

  await writeDashboardSnapshot(fs, await ensureConfigDir(), snapshot);
}

export async function clearDashboardSnapshot(): Promise<void> {
  cache = null;
  cacheLoaded = true;

  if (isDevMock()) {
    writeDevMockSnapshot(null);
    return;
  }

  await clearDashboardSnapshotFile(fs, await ensureConfigDir());
}

export function buildDashboardSnapshot(input: {
  vaultId: string;
  filter: NavFilter;
  search: string;
  itemIds: string[];
  items: DashboardSnapshot["items"];
  totalCount: number;
  streamEndOffset: number;
}): DashboardSnapshot {
  return dashboardSnapshotSchema.parse({
    schema_version: 1,
    vault_id: input.vaultId,
    nav_filter: navFilterToSetting(input.filter),
    search: input.search,
    item_ids: input.itemIds,
    items: input.items,
    total_count: input.totalCount,
    stream_end_offset: input.streamEndOffset,
    saved_at: new Date().toISOString(),
  });
}
