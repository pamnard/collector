import {
  navFilterSettingKey,
  type DashboardSnapshot,
} from "@collector/shared";
import { createDashboardSnapshotService } from "@collector/service";
import { UnsupportedBrowserFsAdapter } from "../adapters/unsupported-fs";
import { isDevMock } from "../dev/is-dev-mock";
import { snapshotToCacheEntry } from "../lib/dashboard-commit";
import type { NavFilter } from "../types/ui";
import {
  dashboardQueryCacheKey,
  getDashboardQueryCache,
  setDashboardQueryCache,
} from "./dashboard-query-cache";

const DEV_MOCK_SNAPSHOT_KEY = "collector-dev-mock-dashboard-snapshot";

const fs = new UnsupportedBrowserFsAdapter();

async function ensureConfigDir(): Promise<string> {
  if (isDevMock()) {
    return "/dev-mock/config";
  }
  throw new Error(
    "UI-local dashboard snapshot requires DevMock or host CollectorService (#555)",
  );
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

/** Seed React Query dashboard cache when a snapshot is loaded (#150 / #552). */
export function seedQueryCacheFromSnapshot(snapshot: DashboardSnapshot): void {
  const key = dashboardQueryCacheKey(
    navFilterSettingKey(snapshot.nav_filter),
    snapshot.search,
    snapshot.sort_key ?? "created_at",
    snapshot.sort_dir ?? "desc",
  );
  if (getDashboardQueryCache(key)) {
    return;
  }
  setDashboardQueryCache(key, snapshotToCacheEntry(snapshot));
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
  sort?: { key: string; dir: "asc" | "desc" },
): DashboardSnapshot | null {
  return dashboardSnapshot.peekMatchingDashboardSnapshot({
    vaultId,
    filter,
    search,
    sort,
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
  sort?: { key: string; dir: "asc" | "desc" };
  itemIds: string[];
  items: DashboardSnapshot["items"];
  totalCount: number;
  streamEndOffset: number;
  coverPaths?: DashboardSnapshot["cover_paths"];
  bodyStamps?: Record<string, string>;
}): DashboardSnapshot {
  return dashboardSnapshot.buildDashboardSnapshot(input);
}
