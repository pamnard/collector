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
 *
 * Reflect.get must not pass the Proxy as receiver: Map.prototype.size is a
 * getter that rejects incompatible receivers.
 */
function sealMap<K, V>(source: ReadonlyMap<K, V>): Map<K, V> {
  const map = new Map(source);
  return new Proxy(map, {
    get(target, prop) {
      if (MAP_MUTATORS.has(prop)) {
        return () => {
          throw new TypeError(`Cannot mutate sealed Map via .${String(prop)}()`);
        };
      }
      const value = Reflect.get(target, prop);
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
  });
}

/** Clone + seal so get() can share refs without store poisoning (#665). */
function sealEntry(entry: DashboardQueryCacheEntry): DashboardQueryCacheEntry {
  if (!entry.thumbnailSizes) {
    throw new Error("DashboardQueryCacheEntry.thumbnailSizes is required");
  }
  return Object.freeze({
    itemIds: Object.freeze([...entry.itemIds]),
    itemsById: sealMap(entry.itemsById),
    bodyStamps: sealMap(entry.bodyStamps),
    thumbnailPaths: sealMap(entry.thumbnailPaths),
    thumbnailStamps: sealMap(entry.thumbnailStamps),
    thumbnailSizes: sealMap(entry.thumbnailSizes),
    streamEndOffset: entry.streamEndOffset,
    totalCount: entry.totalCount,
    updatedAt: entry.updatedAt,
  }) as DashboardQueryCacheEntry;
}

/** Structural-sharing cover replace: keep list/body Maps, seal new thumbnails. */
function entryWithSealedCovers(
  entry: DashboardQueryCacheEntry,
  thumbnailPaths: ReadonlyMap<string, string | null>,
  thumbnailStamps: ReadonlyMap<string, string>,
  thumbnailSizes: ReadonlyMap<
    string,
    import("@collector/api").ItemThumbnailPixelSize | null
  >,
): DashboardQueryCacheEntry {
  return Object.freeze({
    itemIds: entry.itemIds,
    itemsById: entry.itemsById,
    bodyStamps: entry.bodyStamps,
    streamEndOffset: entry.streamEndOffset,
    totalCount: entry.totalCount,
    thumbnailPaths: sealMap(thumbnailPaths),
    thumbnailStamps: sealMap(thumbnailStamps),
    thumbnailSizes: sealMap(thumbnailSizes),
    updatedAt: Date.now(),
  }) as DashboardQueryCacheEntry;
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
 * thumbnail maps. Returns false when the key is absent (e.g. LRU-evicted);
 * callers may fall back to a full `setDashboardQueryCache` rewrite.
 */
export function patchDashboardQueryCacheCovers(
  key: string,
  thumbnailPaths: ReadonlyMap<string, string | null>,
  thumbnailStamps: ReadonlyMap<string, string>,
  thumbnailSizes: ReadonlyMap<
    string,
    import("@collector/api").ItemThumbnailPixelSize | null
  >,
): boolean {
  const entry = entries.get(key);
  if (!entry) {
    return false;
  }
  touch(
    key,
    entryWithSealedCovers(
      entry,
      thumbnailPaths,
      thumbnailStamps,
      thumbnailSizes,
    ),
  );
  return true;
}

export type CoverFlightPatchResult = "patched" | "rewritten" | "skipped";

export type ApplyDashboardQueryCacheCoverFlightPatchOptions = {
  flightKey: string;
  flightVersion: number;
  getLiveKey: () => string;
  getLiveVersion: () => number;
  thumbnailPaths: ReadonlyMap<string, string | null>;
  thumbnailStamps: ReadonlyMap<string, string>;
  thumbnailSizes: ReadonlyMap<
    string,
    import("@collector/api").ItemThumbnailPixelSize | null
  >;
  /** Full rewrite when the flight key was LRU-evicted mid-flight. */
  rewriteFull: () => void;
};

/**
 * Progressive cover commit for one in-flight query. Patches only `flightKey`
 * and only while live key+version still match — layout can advance
 * `queryKeyRef` before the effect bumps version / aborts the flight.
 */
export function applyDashboardQueryCacheCoverFlightPatch(
  options: ApplyDashboardQueryCacheCoverFlightPatchOptions,
): CoverFlightPatchResult {
  if (
    options.getLiveVersion() !== options.flightVersion ||
    options.getLiveKey() !== options.flightKey
  ) {
    return "skipped";
  }
  if (
    patchDashboardQueryCacheCovers(
      options.flightKey,
      options.thumbnailPaths,
      options.thumbnailStamps,
      options.thumbnailSizes,
    )
  ) {
    return "patched";
  }
  options.rewriteFull();
  return "rewritten";
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
