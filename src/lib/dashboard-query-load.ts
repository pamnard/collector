/**
 * Dashboard query cache / warm-snapshot load helpers (#668).
 */

import type { DashboardQueryCacheEntry } from "../services/dashboard-query-cache.ts";
import type { ItemFile } from "@collector/shared";
import { orderDashboardItems } from "./dashboard-display.ts";

export type BuildDashboardQueryCacheEntryInput = {
  itemIds: string[];
  itemsById: Map<string, ItemFile>;
  bodyStamps: Map<string, string>;
  streamEndOffset: number;
  totalCount: number;
  thumbnailPaths: Map<string, string | null>;
  thumbnailStamps: Map<string, string>;
  now?: number;
};

export function buildDashboardQueryCacheEntry(
  input: BuildDashboardQueryCacheEntryInput,
): DashboardQueryCacheEntry {
  return {
    itemIds: [...input.itemIds],
    itemsById: new Map(input.itemsById),
    bodyStamps: new Map(input.bodyStamps),
    streamEndOffset: input.streamEndOffset,
    totalCount: input.totalCount,
    thumbnailPaths: new Map(input.thumbnailPaths),
    thumbnailStamps: new Map(input.thumbnailStamps),
    updatedAt: input.now ?? Date.now(),
  };
}

export type CacheEntryAppliedState = {
  itemIds: string[];
  itemsById: Map<string, ItemFile>;
  bodyStamps: Map<string, string>;
  streamEndOffset: number;
  totalCount: number;
  ordered: ItemFile[];
  thumbnailPaths: Map<string, string | null>;
  thumbnailStamps: Map<string, string>;
  hasMore: boolean;
};

/** Derive working + committed paint fields from a cache entry (no React). */
export function stateFromDashboardCacheEntry(
  entry: DashboardQueryCacheEntry,
): CacheEntryAppliedState {
  const paths = new Map(entry.thumbnailPaths);
  const stamps = new Map(entry.thumbnailStamps);
  const ordered = orderDashboardItems(
    entry.itemIds,
    entry.itemsById,
    entry.streamEndOffset,
  );
  return {
    itemIds: entry.itemIds,
    itemsById: entry.itemsById,
    bodyStamps: new Map(entry.bodyStamps),
    streamEndOffset: entry.streamEndOffset,
    totalCount: entry.totalCount,
    ordered,
    thumbnailPaths: paths,
    thumbnailStamps: stamps,
    hasMore: entry.streamEndOffset < entry.totalCount,
  };
}

export type ReadInitialDashboardCacheEntryOptions<TSnapshot> = {
  cacheKey: string;
  getCached: (key: string) => DashboardQueryCacheEntry | null | undefined;
  setCached: (key: string, entry: DashboardQueryCacheEntry) => void;
  vaultId: string | null | undefined;
  peekWarmSnapshot: () => TSnapshot | null | undefined;
  snapshotToEntry: (snapshot: TSnapshot) => DashboardQueryCacheEntry;
};

export function readInitialDashboardCacheEntry<TSnapshot>(
  options: ReadInitialDashboardCacheEntryOptions<TSnapshot>,
): DashboardQueryCacheEntry | null {
  const cached = options.getCached(options.cacheKey);
  if (cached) {
    return cached;
  }

  if (!options.vaultId) {
    return null;
  }

  const warm = options.peekWarmSnapshot();
  if (!warm) {
    return null;
  }

  const entry = options.snapshotToEntry(warm);
  options.setCached(options.cacheKey, entry);
  return options.getCached(options.cacheKey) ?? entry;
}
