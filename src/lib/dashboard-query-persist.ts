/**
 * Deferred dashboard query + session snapshot persist (#929).
 * Pure of React: hook owns the timer ref and effect deps.
 */

import type { DashboardItemSort } from "@collector/api";
import type { DashboardSnapshot, ItemFile } from "@collector/shared";
import type { NavFilter } from "../types/ui.ts";
import type { DashboardQueryCacheEntry } from "../services/dashboard-query-cache.ts";
import {
  coverMapsPersistenceViews,
  type CoverMaps,
} from "./cover-maps.ts";
import { bodyStampsFromMap } from "./dashboard-commit.ts";
import { buildDashboardQueryCacheEntry } from "./dashboard-query-load.ts";

export const DASHBOARD_QUERY_PERSIST_DEBOUNCE_MS = 400;

export type DashboardQueryPersistSnapshotPort = {
  buildDashboardSnapshot: (input: {
    vaultId: string;
    filter: NavFilter;
    search: string;
    sort?: DashboardItemSort;
    itemIds: string[];
    items: DashboardSnapshot["items"];
    totalCount: number;
    streamEndOffset: number;
    coverPaths?: DashboardSnapshot["cover_paths"];
    bodyStamps?: Record<string, string>;
  }) => DashboardSnapshot;
  persistDashboardSnapshot: (snapshot: DashboardSnapshot) => Promise<void>;
};

export type BuildDashboardQueryPersistPayloadInput = {
  vaultId: string;
  filter: NavFilter;
  searchQuery: string;
  sort: DashboardItemSort;
  itemIds: string[];
  workingItems: ItemFile[];
  itemsById: Map<string, ItemFile>;
  totalCount: number;
  streamEndOffset: number;
  coverMaps: CoverMaps;
  bodyStamps: Map<string, string>;
};

export type DashboardQueryPersistPayload = {
  snapshot: {
    vaultId: string;
    filter: NavFilter;
    search: string;
    sort: DashboardItemSort;
    itemIds: string[];
    items: ItemFile[];
    totalCount: number;
    streamEndOffset: number;
    coverPaths: DashboardSnapshot["cover_paths"];
    bodyStamps: Record<string, string>;
  };
  cacheEntry: DashboardQueryCacheEntry;
  persistedCovers: CoverMaps;
};

export function buildDashboardQueryPersistPayload(
  input: BuildDashboardQueryPersistPayloadInput,
): DashboardQueryPersistPayload {
  const { maps: persisted, record: coverPaths } = coverMapsPersistenceViews(
    input.coverMaps,
  );
  return {
    snapshot: {
      vaultId: input.vaultId,
      filter: input.filter,
      search: input.searchQuery,
      sort: input.sort,
      itemIds: input.itemIds,
      items: input.workingItems,
      totalCount: input.totalCount,
      streamEndOffset: input.streamEndOffset,
      coverPaths,
      bodyStamps: bodyStampsFromMap(input.bodyStamps),
    },
    cacheEntry: buildDashboardQueryCacheEntry({
      itemIds: input.itemIds,
      itemsById: input.itemsById,
      bodyStamps: input.bodyStamps,
      streamEndOffset: input.streamEndOffset,
      totalCount: input.totalCount,
      covers: persisted,
    }),
    persistedCovers: persisted,
  };
}

export type ScheduleDashboardQueryPersistInput = {
  delayMs?: number;
  setTimer: (timer: ReturnType<typeof setTimeout>) => void;
  clearTimer: () => void;
  getCoverMaps: () => CoverMaps;
  payloadInput: Omit<BuildDashboardQueryPersistPayloadInput, "coverMaps">;
  snapshotPort: DashboardQueryPersistSnapshotPort;
  setCached: (key: string, entry: DashboardQueryCacheEntry) => void;
  queryKey: string;
};

/**
 * Debounced persist of session snapshot + in-memory query cache.
 * Returns a cancel function for effect cleanup.
 */
export function scheduleDashboardQueryPersist(
  input: ScheduleDashboardQueryPersistInput,
): () => void {
  input.clearTimer();
  const delay = input.delayMs ?? DASHBOARD_QUERY_PERSIST_DEBOUNCE_MS;
  const timer = setTimeout(() => {
    const payload = buildDashboardQueryPersistPayload({
      ...input.payloadInput,
      coverMaps: input.getCoverMaps(),
    });
    void input.snapshotPort.persistDashboardSnapshot(
      input.snapshotPort.buildDashboardSnapshot(payload.snapshot),
    );
    input.setCached(input.queryKey, payload.cacheEntry);
  }, delay);
  input.setTimer(timer);
  return () => {
    input.clearTimer();
  };
}

/** Whether the persist effect should arm a timer (mirrors prior hook guard). */
export function shouldScheduleDashboardQueryPersist(options: {
  vaultId: string | null;
  isLoading: boolean;
  itemIdsLength: number;
  workingItemsLength: number;
}): boolean {
  return Boolean(
    options.vaultId &&
      !options.isLoading &&
      options.itemIdsLength > 0 &&
      options.workingItemsLength > 0,
  );
}
