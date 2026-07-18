import type { ItemFile } from "@collector/shared";

export const DASHBOARD_QUERY_CACHE_MAX = 16;

export interface DashboardQueryCacheEntry {
  itemIds: string[];
  itemsById: Map<string, ItemFile>;
  streamEndOffset: number;
  totalCount: number;
  thumbnailPaths: Map<string, string | null>;
  updatedAt: number;
}

export function dashboardQueryCacheKey(
  filterKey: string,
  search: string,
): string {
  return `${filterKey}|${search.trim()}`;
}

const entries = new Map<string, DashboardQueryCacheEntry>();

function touch(key: string, entry: DashboardQueryCacheEntry): void {
  entries.delete(key);
  entries.set(key, entry);
}

export function getDashboardQueryCache(
  key: string,
): DashboardQueryCacheEntry | null {
  const entry = entries.get(key);
  if (!entry) {
    return null;
  }
  touch(key, entry);
  return {
    itemIds: [...entry.itemIds],
    itemsById: new Map(entry.itemsById),
    thumbnailPaths: new Map(entry.thumbnailPaths),
    streamEndOffset: entry.streamEndOffset,
    totalCount: entry.totalCount,
    updatedAt: entry.updatedAt,
  };
}

export function setDashboardQueryCache(
  key: string,
  entry: DashboardQueryCacheEntry,
): void {
  touch(key, {
    ...entry,
    itemsById: new Map(entry.itemsById),
    thumbnailPaths: new Map(entry.thumbnailPaths),
    itemIds: [...entry.itemIds],
    updatedAt: entry.updatedAt,
  });

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
    if (!entry.itemIds.includes(itemId) && !entry.itemsById.has(itemId)) {
      continue;
    }
    const itemIds = entry.itemIds.filter((id) => id !== itemId);
    const itemsById = new Map(entry.itemsById);
    itemsById.delete(itemId);
    const thumbnailPaths = new Map(entry.thumbnailPaths);
    thumbnailPaths.delete(itemId);
    const removedCount = entry.itemIds.length - itemIds.length;
    touch(key, {
      itemIds,
      itemsById,
      thumbnailPaths,
      streamEndOffset: Math.min(entry.streamEndOffset, itemIds.length),
      totalCount: Math.max(0, entry.totalCount - removedCount),
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
