/**
 * Dashboard query cache / warm-snapshot load helpers (#668).
 */

import type { DashboardQueryCacheEntry } from "../services/dashboard-query-cache.ts";
import type { ItemFile } from "@collector/shared";
import {
  coverMapsClone,
  coverMapsForPersistence,
  emptyCoverMaps,
  type CoverMaps,
} from "./cover-maps.ts";
import { orderDashboardItems } from "./dashboard-display.ts";

export type BuildDashboardQueryCacheEntryInput = {
  itemIds: string[];
  itemsById: Map<string, ItemFile>;
  bodyStamps: Map<string, string>;
  streamEndOffset: number;
  totalCount: number;
  covers: CoverMaps;
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
    covers: coverMapsClone(input.covers),
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
  covers: CoverMaps;
  hasMore: boolean;
};

/** Working + committed paint from a cache entry; always mutable copies. */
export function stateFromDashboardCacheEntry(
  entry: DashboardQueryCacheEntry,
): CacheEntryAppliedState {
  if (!entry.covers) {
    throw new Error("DashboardQueryCacheEntry.covers is required");
  }
  const itemIds = [...entry.itemIds];
  const itemsById = new Map(entry.itemsById);
  const ordered = orderDashboardItems(
    itemIds,
    itemsById,
    entry.streamEndOffset,
  );
  return {
    itemIds,
    itemsById,
    bodyStamps: new Map(entry.bodyStamps),
    streamEndOffset: entry.streamEndOffset,
    totalCount: entry.totalCount,
    ordered,
    covers: coverMapsClone(coverMapsForPersistence(entry.covers)),
    hasMore: entry.streamEndOffset < entry.totalCount,
  };
}

export type ReadInitialDashboardCacheEntryOptions<TSnapshot> = {
  cacheKey: string;
  getCached: (key: string) => DashboardQueryCacheEntry | null | undefined;
  setCached: (key: string, entry: DashboardQueryCacheEntry) => void;
  vaultId: string | null | undefined;
  peekWarmSnapshot: () => TSnapshot | null | undefined;
  snapshotToEntry: (snap: TSnapshot) => DashboardQueryCacheEntry;
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

export { emptyCoverMaps };
