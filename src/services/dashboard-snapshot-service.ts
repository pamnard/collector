import { appConfigDir, join } from "@tauri-apps/api/path";
import {
  dashboardSnapshotMatchesQuery,
  dashboardSnapshotSchema,
  navFilterSettingKey,
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
import {
  dashboardQueryCacheKey,
  getDashboardQueryCache,
  setDashboardQueryCache,
} from "./dashboard-query-cache";

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

export async function ensureDashboardSnapshot(): Promise<DashboardSnapshot | null> {
  if (cacheLoaded) {
    return cache;
  }

  if (isDevMock()) {
    cache = readDevMockSnapshot();
    cacheLoaded = true;
    if (cache) {
      seedQueryCacheFromSnapshot(cache);
    }
    return cache;
  }

  cache = await readDashboardSnapshot(fs, await ensureConfigDir());
  cacheLoaded = true;
  if (cache) {
    seedQueryCacheFromSnapshot(cache);
  }
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
