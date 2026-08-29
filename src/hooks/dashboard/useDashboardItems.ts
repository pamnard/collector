import { useCallback, useRef, useSyncExternalStore } from "react";
import type {
  DashboardItemSort,
  VaultPresentationChangedPayload,
} from "@collector/api";
import type { ItemFile } from "@collector/shared";
import { useAppSettings } from "../../context/AppSettingsContext";
import { dashboardLiveActionForEvent } from "../../lib/vault-presentation-affects";
import { itemIdToPruneFromPresentationEvent } from "../../lib/presentation-prune-item-id";
import {
  coverMapsFromCacheEntry,
  createCoverController,
  type CoverController,
} from "../../lib/cover-controller";
import {
  emptyCoverMaps,
  type CoverMaps,
} from "../../lib/cover-maps";
import { snapshotToCacheEntry } from "../../lib/dashboard-commit";
import { readInitialDashboardCacheEntry } from "../../lib/dashboard-query-load";
import { resolveDashboardCoverPathsProgressive } from "../../lib/preload-dashboard-covers";
import {
  dashboardQueryCacheKey,
  getDashboardQueryCache,
  setDashboardQueryCache,
} from "../../services/dashboard-query-cache";
import { getUiSession } from "../../services/collector-client";
import { navFilterKey, type NavFilter } from "../../types/ui";
import { useVaultIndexSyncStatus } from "../useVaultIndexSyncStatus";
import { persistDashboardCoverMapsToCache } from "./commit-dashboard-cover-maps";
import { useDashboardCoverFlight } from "./useDashboardCoverFlight";
import { useDashboardListState } from "./useDashboardListState";
import type {
  DashboardListState,
  StartCoverPathFlight,
} from "./dashboard-list-state-types";
import { useDashboardQueryLifecycle } from "./useDashboardQueryLifecycle";

export { DASHBOARD_PREFETCH_SIZE } from "../../services/collector-client";

export const DEFAULT_DASHBOARD_SORT: DashboardItemSort = {
  key: "created_at",
  dir: "desc",
};

export interface UseDashboardItemsResult {
  items: ItemFile[];
  /** Opaque cover SoT for masonry (#874). */
  coverMaps: CoverMaps;
  totalCount: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => void;
  pruneItem: (itemId: string) => void;
  refreshCoverForItem: (itemId: string) => void;
  probeStickyNulls: (items: ItemFile[]) => void;
  applyPresentationEvents: (
    events: VaultPresentationChangedPayload[],
  ) => void;
}

function readInitialCacheEntry(
  filter: NavFilter,
  searchQuery: string,
  sort: DashboardItemSort,
  vaultId: string | null | undefined,
) {
  return readInitialDashboardCacheEntry({
    cacheKey: dashboardQueryCacheKey(
      navFilterKey(filter),
      searchQuery,
      sort.key,
      sort.dir,
    ),
    getCached: getDashboardQueryCache,
    setCached: setDashboardQueryCache,
    vaultId,
    peekWarmSnapshot: () => {
      if (!vaultId) {
        return null;
      }
      return getUiSession().snapshot.peekMatchingDashboardSnapshot({
        vaultId,
        filter,
        search: searchQuery,
        sort,
      });
    },
    snapshotToEntry: snapshotToCacheEntry,
  });
}

export function useDashboardItems(
  filter: NavFilter,
  searchQuery: string,
  vaultRevision: number,
  sort: DashboardItemSort = DEFAULT_DASHBOARD_SORT,
): UseDashboardItemsResult {
  const { settings } = useAppSettings();
  const vaultId = settings.active_vault_id ?? null;
  const indexSync = useVaultIndexSyncStatus();

  const startCoverPathFlightRef = useRef<StartCoverPathFlight>(async () => {});
  const listRef = useRef<DashboardListState | null>(null);
  const initialCacheRef = useRef<ReturnType<typeof readInitialCacheEntry> | undefined>(
    undefined,
  );
  if (initialCacheRef.current === undefined) {
    initialCacheRef.current = readInitialCacheEntry(
      filter,
      searchQuery,
      sort,
      vaultId,
    );
  }

  const coversRef = useRef<CoverController | null>(null);
  if (coversRef.current === null) {
    const initial = initialCacheRef.current;
    coversRef.current = createCoverController(
      {
        resolveProgressive: resolveDashboardCoverPathsProgressive,
        getRequestVersion: () =>
          listRef.current?.requestVersionRef.current ?? 0,
        getQueryKey: () => listRef.current?.queryKeyRef.current ?? "",
        getItem: (id) => listRef.current?.itemsByIdRef.current.get(id),
        persistMaps: (maps, meta) => {
          const list = listRef.current;
          if (!list) {
            return;
          }
          persistDashboardCoverMapsToCache({
            flightKey: meta.flightKey,
            flightVersion: meta.flightVersion,
            queryKeyRef: list.queryKeyRef,
            requestVersionRef: list.requestVersionRef,
            itemIds: list.itemIdsRef.current,
            itemsById: list.itemsByIdRef.current,
            bodyStamps: list.bodyStampsRef.current,
            streamEndOffset: list.streamEndOffsetRef.current,
            totalCount: list.totalCountRef.current,
            maps,
          });
        },
      },
      initial
        ? coverMapsFromCacheEntry(initial)
        : emptyCoverMaps(),
    );
  }
  const coversController = coversRef.current;

  const list = useDashboardListState({
    filter,
    searchQuery,
    sort,
    vaultId,
    startCoverPathFlightRef,
    covers: coversController,
    initialCache: initialCacheRef.current,
  });
  listRef.current = list;

  const isIndexingEmptyGrid =
    (indexSync.status === "running" || indexSync.status === "rebuilding") &&
    list.committedTotalCount === 0 &&
    list.committedItems.length === 0;

  const showSkeleton =
    (list.isLoading && list.committedItems.length === 0) ||
    isIndexingEmptyGrid;

  const covers = useDashboardCoverFlight({
    showSkeleton,
    committedItems: list.committedItems,
    covers: coversController,
    startCoverPathFlightRef,
  });

  const coverMaps = useSyncExternalStore(
    coversController.subscribe,
    coversController.getPublishedMaps,
    coversController.getPublishedMaps,
  );

  const query = useDashboardQueryLifecycle({
    filter,
    searchQuery,
    sort,
    vaultId,
    vaultRevision,
    list,
    abortCoverFlight: covers.abortCoverFlight,
    indexSync,
  });

  const applyPresentationEvents = useCallback(
    (events: VaultPresentationChangedPayload[]) => {
      let softRefresh = false;
      for (const event of events) {
        const action = dashboardLiveActionForEvent(
          list.filterRef.current,
          event,
        );
        if (action === "ignore") {
          continue;
        }
        if (action === "prune") {
          const pruneId = itemIdToPruneFromPresentationEvent(event);
          if (pruneId) {
            list.pruneItem(pruneId);
          }
          continue;
        }
        if (action === "coverPatch") {
          if (event.itemId) {
            covers.refreshCoverForItem(event.itemId);
          }
          continue;
        }
        if (action === "softRefresh") {
          softRefresh = true;
        }
      }
      if (softRefresh) {
        query.syncRepublishRef.current?.flush();
      }
    },
    [
      covers.refreshCoverForItem,
      list.filterRef,
      list.pruneItem,
      query.syncRepublishRef,
    ],
  );

  return {
    items: list.committedItems,
    coverMaps,
    totalCount: list.committedTotalCount,
    isLoading: showSkeleton,
    isLoadingMore: list.isLoadingMore,
    hasMore: list.committedHasMore,
    error: list.error,
    loadMore: query.loadMore,
    pruneItem: list.pruneItem,
    refreshCoverForItem: covers.refreshCoverForItem,
    probeStickyNulls: covers.probeStickyNulls,
    applyPresentationEvents,
  };
}
