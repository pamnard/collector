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

const MAP_MUTATORS = new Set<PropertyKey>(["set", "delete", "clear"]);

/**
 * Map.prototype.set/delete/clear ignore Object.freeze; Proxy blocks mutation so
 * shared get() refs cannot poison the store (#665).
 */
function sealMap<K, V>(source: ReadonlyMap<K, V>): Map<K, V> {
  const map = new Map(source);
  return new Proxy(map, {
    get(target, prop, receiver) {
      if (MAP_MUTATORS.has(prop)) {
        return () => {
          throw new TypeError(`Cannot mutate sealed Map via .${String(prop)}()`);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
  });
}

/** Clone + seal so get() can share refs without store poisoning (#665). */
function sealEntry(entry: DashboardQueryCacheEntry): DashboardQueryCacheEntry {
  return Object.freeze({
    itemIds: Object.freeze([...entry.itemIds]),
    itemsById: sealMap(entry.itemsById),
    bodyStamps: sealMap(entry.bodyStamps),
    thumbnailPaths: sealMap(entry.thumbnailPaths),
    thumbnailStamps: sealMap(entry.thumbnailStamps),
    streamEndOffset: entry.streamEndOffset,
    totalCount: entry.totalCount,
    updatedAt: entry.updatedAt,
  });
}

/** Structural-sharing cover replace: keep list/body Maps, seal new thumbnails. */
function entryWithSealedCovers(
  entry: DashboardQueryCacheEntry,
  thumbnailPaths: ReadonlyMap<string, string | null>,
  thumbnailStamps: ReadonlyMap<string, string>,
): DashboardQueryCacheEntry {
  return Object.freeze({
    itemIds: entry.itemIds,
    itemsById: entry.itemsById,
    bodyStamps: entry.bodyStamps,
    streamEndOffset: entry.streamEndOffset,
    totalCount: entry.totalCount,
    thumbnailPaths: sealMap(thumbnailPaths),
    thumbnailStamps: sealMap(thumbnailStamps),
    updatedAt: Date.now(),
  });
}

function evictOverflow(): void {
  while (entries.size > DASHBOARD_QUERY_CACHE_MAX) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    entries.delete(oldest);
  }
}

export function getDashboardQueryCache(
  key: string,
): DashboardQueryCacheEntry | null {
  const entry = entries.get(key);
  if (!entry) {
    return null;
  }
  touch(key, entry);
  return entry;
}

export function setDashboardQueryCache(
  key: string,
  entry: DashboardQueryCacheEntry,
): void {
  touch(key, sealEntry(entry));
  evictOverflow();
}

/**
 * Copy-on-write cover update: reuse list/body containers; replace only
 * thumbnail maps. No-op when the key is absent.
 */
export function patchDashboardQueryCacheCovers(
  key: string,
  thumbnailPaths: ReadonlyMap<string, string | null>,
  thumbnailStamps: ReadonlyMap<string, string>,
): void {
  const entry = entries.get(key);
  if (!entry) {
    return;
  }
  touch(key, entryWithSealedCovers(entry, thumbnailPaths, thumbnailStamps));
}

export function removeItemIdFromDashboardQueryCache(itemId: string): void {
  for (const [key, entry] of entries) {
    const pruned = pruneItemIdFromDashboardListSnapshot(itemId, entry);
    if (!pruned.removed) {
      continue;
    }
    touch(key, sealEntry({ ...pruned, updatedAt: Date.now() }));
  }
}

export function clearDashboardQueryCache(): void {
  entries.clear();
}

export function dashboardQueryCacheKeysForTests(): string[] {
  return [...entries.keys()];
}
