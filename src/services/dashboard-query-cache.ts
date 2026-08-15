import {
  pruneItemIdFromDashboardListSnapshot,
  type DashboardListSnapshot,
} from "../lib/dashboard-list-snapshot.ts";

export const DASHBOARD_QUERY_CACHE_MAX = 16;

/** Cached dashboard list page; `bodyStamps` are index file_mtime_ms (#623). */
export interface DashboardQueryCacheEntry extends DashboardListSnapshot {
  updatedAt: number;
}

export function dashboardQueryCacheKey(
  filterKey: string,
  search: string,
  sortKey = "created_at",
  sortDir: "asc" | "desc" = "desc",
): string {
  return `${filterKey}|${search.trim()}|${sortKey}|${sortDir}`;
}

const entries = new Map<string, DashboardQueryCacheEntry>();

function touch(key: string, entry: DashboardQueryCacheEntry): void {
  entries.delete(key);
  entries.set(key, entry);
}

function cloneEntry(entry: DashboardQueryCacheEntry): DashboardQueryCacheEntry {
  return {
    itemIds: [...entry.itemIds],
    itemsById: new Map(entry.itemsById),
    bodyStamps: new Map(entry.bodyStamps),
    thumbnailPaths: new Map(entry.thumbnailPaths),
    thumbnailStamps: new Map(entry.thumbnailStamps),
    streamEndOffset: entry.streamEndOffset,
    totalCount: entry.totalCount,
    updatedAt: entry.updatedAt,
  };
}

export function getDashboardQueryCache(
  key: string,
): DashboardQueryCacheEntry | null {
  const entry = entries.get(key);
  if (!entry) {
    return null;
  }
  touch(key, entry);
  return cloneEntry(entry);
}

export function setDashboardQueryCache(
  key: string,
  entry: DashboardQueryCacheEntry,
): void {
  touch(key, cloneEntry(entry));

  while (entries.size > DASHBOARD_QUERY_CACHE_MAX) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    entries.delete(oldest);
  }
}

export function removeItemIdFromDashboardQueryCache(itemId: string): void {
  for (const [key, entry] of entries) {
    const pruned = pruneItemIdFromDashboardListSnapshot(itemId, entry);
    if (!pruned.removed) {
      continue;
    }
    touch(key, {
      itemIds: pruned.itemIds,
      itemsById: pruned.itemsById,
      bodyStamps: pruned.bodyStamps,
      thumbnailPaths: pruned.thumbnailPaths,
      thumbnailStamps: pruned.thumbnailStamps,
      streamEndOffset: pruned.streamEndOffset,
      totalCount: pruned.totalCount,
      updatedAt: Date.now(),
    });
  }
}

export function clearDashboardQueryCache(): void {
  entries.clear();
}

export function dashboardQueryCacheKeysForTests(): string[] {
  return [...entries.keys()];
}
