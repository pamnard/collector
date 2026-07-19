import { appConfigDir, join } from "@tauri-apps/api/path";
import {
  navFilterSettingKey,
  type DashboardSnapshot,
} from "@collector/shared";
import { createDashboardSnapshotService } from "@collector/service";
import { TauriFileSystemAdapter } from "../adapters/tauri-fs";
import { isDevMock } from "../dev/is-dev-mock";
import type { NavFilter } from "../types/ui";
import {
  dashboardQueryCacheKey,
  getDashboardQueryCache,
  setDashboardQueryCache,
} from "./dashboard-query-cache";

const DEV_MOCK_SNAPSHOT_KEY = "collector-dev-mock-dashboard-snapshot";

let configDir = "";
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

function seedQueryCacheFromSnapshot(snapshot: DashboardSnapshot): void {
  const key = dashboardQueryCacheKey(
    navFilterSettingKey(snapshot.nav_filter),
    snapshot.search,
  );
  if (getDashboardQueryCache(key)) {
    return;
  }
  setDashboardQueryCache(key, {
    itemIds: [...snapshot.item_ids],
    itemsById: new Map(snapshot.items.map((item) => [item.id, item])),
    streamEndOffset: snapshot.stream_end_offset,
    totalCount: snapshot.total_count,
    thumbnailPaths: new Map(),
    updatedAt: Date.now(),
  });
}

const dashboardSnapshot = createDashboardSnapshotService({
  fs,
  ensureConfigDir,
  isDevMock,
  readDevMockSnapshot,
  writeDevMockSnapshot,
  onSnapshotLoaded: seedQueryCacheFromSnapshot,
});

export async function ensureDashboardSnapshot(): Promise<DashboardSnapshot | null> {
  return dashboardSnapshot.ensureDashboardSnapshot();
}

export function peekMatchingDashboardSnapshot(
  vaultId: string,
  filter: NavFilter,
  search: string,
): DashboardSnapshot | null {
  return dashboardSnapshot.peekMatchingDashboardSnapshot({
    vaultId,
    filter,
    search,
  });
}

export async function persistDashboardSnapshot(
  snapshot: DashboardSnapshot,
): Promise<void> {
  return dashboardSnapshot.persistDashboardSnapshot(snapshot);
}

export async function clearDashboardSnapshot(): Promise<void> {
  return dashboardSnapshot.clearDashboardSnapshot();
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
  return dashboardSnapshot.buildDashboardSnapshot(input);
}
