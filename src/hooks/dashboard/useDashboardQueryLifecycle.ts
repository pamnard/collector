import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
} from "react";
import type { DashboardItemSort, VaultIndexSyncStatus } from "@collector/api";
import { snapshotToCacheEntry } from "../../lib/dashboard-commit";
import { mapIndexQueryResult } from "../../lib/dashboard-display";
import { applyDashboardQueryKeyChange } from "../../lib/dashboard-query-key-change";
import {
  cleanupDashboardIndexQueryWindow,
  prepareDashboardIndexQueryWindow,
  runDashboardIndexQueryWindow,
} from "../../lib/dashboard-index-query-run";
import {
  scheduleDashboardQueryPersist,
  shouldScheduleDashboardQueryPersist,
} from "../../lib/dashboard-query-persist";
import {
  mergePendingIntoItemsById,
  runDashboardLoadMore,
  streamDashboardSlice,
} from "../../lib/dashboard-stream";
import { navFilterKey, type NavFilter } from "../../types/ui";
import {
  DASHBOARD_PREFETCH_SIZE,
  getCollectorService,
  getUiSession,
} from "../../services/collector-client";
import {
  dashboardQueryCacheKey,
  getDashboardQueryCache,
  setDashboardQueryCache,
} from "../../services/dashboard-query-cache";
import { reportServiceError } from "../../services/runtime-error";
import type { DashboardListState } from "./dashboard-list-state-types";
import { applyIndexPageAgainstListState } from "./apply-index-page-against-list";
import { useDashboardSyncRepublish } from "./useDashboardSyncRepublish";

export type UseDashboardQueryLifecycleOptions = {
  filter: NavFilter;
  searchQuery: string;
  sort: DashboardItemSort;
  vaultId: string | null;
  vaultRevision: number;
  list: DashboardListState;
  abortCoverFlight: () => void;
  indexSync: VaultIndexSyncStatus;
};

export type UseDashboardQueryLifecycleResult = {
  loadMore: () => void;
  syncRepublishRef: MutableRefObject<{
    schedule: () => void;
    flush: () => void;
    cancel: () => void;
  } | null>;
};

export function useDashboardQueryLifecycle(
  options: UseDashboardQueryLifecycleOptions,
): UseDashboardQueryLifecycleResult {
  const {
    filter,
    searchQuery,
    sort,
    vaultId,
    vaultRevision,
    list,
    abortCoverFlight,
    indexSync,
  } = options;

  const {
    itemIds,
    itemsById,
    streamEndOffset,
    totalCount,
    isLoading,
    isLoadingMore,
    workingItems,
    requestVersionRef,
    streamEndOffsetRef,
    itemIdsRef,
    itemsByIdRef,
    bodyStampsRef,
    totalCountRef,
    committedItemsRef,
    queryKeyRef,
    streamAbortRef,
    persistTimerRef,
    queryBusyRef,
    filterRef,
    searchQueryRef,
    sortRef,
    covers,
    setItemsById,
    setTotalCount,
    setIsLoading,
    setIsLoadingMore,
    setError,
    applyCacheEntryToState,
    commitWorkingToDisplay,
    setStreamWindowEnd,
    setLoadedItemIds,
    clearWorkingWindow,
    clearCommittedPaint,
  } = list;

  const listRef = useRef(list);
  listRef.current = list;

  const streamSlice = useCallback(
    async (
      ids: string[],
      offset: number,
      limit: number,
      requestVersion: number,
    ): Promise<void> => {
      await streamDashboardSlice({
        ids,
        offset,
        limit,
        requestVersion,
        getRequestVersion: () => requestVersionRef.current,
        abortCurrentStream: () => {
          streamAbortRef.current?.abort();
        },
        beginStream: () => {
          const controller = new AbortController();
          streamAbortRef.current = controller;
          return controller;
        },
        hydrate: (slice, signal) =>
          getCollectorService().items.hydrate(slice, { signal }),
        mergeItems: (pending) => {
          setItemsById((current) => {
            const next = mergePendingIntoItemsById(current, pending);
            itemsByIdRef.current = next;
            return next;
          });
        },
      });
    },
    [itemsByIdRef, requestVersionRef, setItemsById, streamAbortRef],
  );

  const applyIndexPage = useCallback(
    async (
      page: {
        itemIds: string[];
        stamps: string[];
        totalCount: number;
        offset: number;
      },
      requestVersion: number,
    ): Promise<void> => {
      await applyIndexPageAgainstListState(
        listRef.current,
        page,
        requestVersion,
        streamSlice,
      );
    },
    [streamSlice],
  );

  // Object folder/tag filters are new each render from navFilterFromSetting;
  // depend on filterKey only (#82). Do not re-add `filter` to deps (#114 / #78 regression).
  const filterKey = navFilterKey(filter);
  const queryKey = dashboardQueryCacheKey(
    filterKey,
    searchQuery,
    sort.key,
    sort.dir,
  );

  useLayoutEffect(() => {
    const result = applyDashboardQueryKeyChange({
      prevQueryKey: queryKeyRef.current,
      nextQueryKey: queryKey,
      prevCommittedCount: committedItemsRef.current.length,
      vaultId,
      getCached: getDashboardQueryCache,
      setCached: setDashboardQueryCache,
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
      sinks: {
        abortCoverFlight,
        setError,
        applyCacheEntryToState,
        setIsLoading,
        clearWorkingWindow,
        clearCommittedPaint,
      },
    });
    if (result.kind !== "unchanged") {
      queryKeyRef.current = queryKey;
    }
  }, [
    abortCoverFlight,
    applyCacheEntryToState,
    clearCommittedPaint,
    clearWorkingWindow,
    filter,
    queryKey,
    searchQuery,
    setError,
    setIsLoading,
    sort,
    vaultId,
  ]);

  useEffect(() => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    queryKeyRef.current = queryKey;
    queryBusyRef.current = true;

    prepareDashboardIndexQueryWindow({
      queryKey,
      getCached: getDashboardQueryCache,
      sinks: {
        setError,
        setLoadedItemIds,
        setItemsById,
        setTotalCount,
        setStreamWindowEnd,
        setIsLoading,
        syncWorkingRefs: (working) => {
          itemsByIdRef.current = working.itemsById;
          bodyStampsRef.current = working.bodyStamps;
          totalCountRef.current = working.totalCount;
        },
        clearWorkingBodies: () => {
          itemsByIdRef.current = new Map();
          bodyStampsRef.current = new Map();
        },
        getCommittedCount: () => committedItemsRef.current.length,
        abortStream: () => {
          streamAbortRef.current?.abort();
        },
        abortCoverFlight,
      },
    });

    const controller = new AbortController();
    void runDashboardIndexQueryWindow({
      requestVersion,
      signal: controller.signal,
      filter,
      searchQuery,
      sort,
      prefetchSize: DASHBOARD_PREFETCH_SIZE,
      getRequestVersion: () => requestVersionRef.current,
      queryIndex: (f, search, range, s) =>
        getCollectorService().items.queryIndex(f, search, range, s),
      applyIndexPage,
      commitWorkingToDisplay,
      setError,
      setIsLoading,
      setQueryBusy: (busy) => {
        queryBusyRef.current = busy;
      },
      reportError: reportServiceError,
    });

    return () => {
      cleanupDashboardIndexQueryWindow({
        requestVersion,
        getRequestVersion: () => requestVersionRef.current,
        abortController: controller,
        abortStream: () => {
          streamAbortRef.current?.abort();
        },
        abortCoverFlight,
        setQueryBusy: (busy) => {
          queryBusyRef.current = busy;
        },
      });
    };
  }, [
    applyIndexPage,
    commitWorkingToDisplay,
    filterKey,
    queryKey,
    searchQuery,
    setLoadedItemIds,
    setStreamWindowEnd,
    vaultId,
    vaultRevision,
    abortCoverFlight,
  ]);

  const { syncRepublishRef } = useDashboardSyncRepublish({
    indexSync,
    requestVersionRef,
    itemIdsRef,
    filterRef,
    searchQueryRef,
    sortRef,
    applyIndexPage,
    commitWorkingToDisplay,
  });

  useEffect(() => {
    if (isLoading || queryBusyRef.current) {
      return;
    }
    // Do not sync an empty working window over held cards (cold-miss flash).
    if (
      workingItems.length === 0 &&
      committedItemsRef.current.length > 0 &&
      totalCount > 0
    ) {
      return;
    }
    // load-more / in-place stream growth: always go through commit so id-set
    // changes hold cover paint (#913). Do not setCommittedItems here.
    void commitWorkingToDisplay(requestVersionRef.current, {
      blockOnCovers: true,
    });
  }, [
    commitWorkingToDisplay,
    isLoading,
    workingItems,
    totalCount,
    streamEndOffset,
  ]);

  useEffect(() => {
    if (
      !shouldScheduleDashboardQueryPersist({
        vaultId,
        isLoading,
        itemIdsLength: itemIds.length,
        workingItemsLength: workingItems.length,
      })
    ) {
      return;
    }
    if (!vaultId) {
      return;
    }

    return scheduleDashboardQueryPersist({
      setTimer: (timer) => {
        persistTimerRef.current = timer;
      },
      clearTimer: () => {
        if (persistTimerRef.current) {
          clearTimeout(persistTimerRef.current);
          persistTimerRef.current = null;
        }
      },
      getCoverMaps: () => covers.getMaps(),
      payloadInput: {
        vaultId,
        filter,
        searchQuery,
        sort,
        itemIds,
        workingItems,
        itemsById,
        totalCount,
        streamEndOffset,
        bodyStamps: bodyStampsRef.current,
      },
      snapshotPort: getUiSession().snapshot,
      setCached: setDashboardQueryCache,
      queryKey,
    });
  }, [
    covers,
    filterKey,
    isLoading,
    itemIds,
    itemsById,
    workingItems,
    queryKey,
    searchQuery,
    sort,
    streamEndOffset,
    totalCount,
    vaultId,
  ]);

  const loadMore = useCallback(() => {
    void runDashboardLoadMore({
      isLoading,
      isLoadingMore,
      streamEndOffset,
      loadedCount: itemIds.length,
      totalCount,
      prefetchSize: DASHBOARD_PREFETCH_SIZE,
      getRequestVersion: () => requestVersionRef.current,
      getItemIds: () => itemIdsRef.current,
      getStreamEnd: () => streamEndOffsetRef.current,
      setIsLoadingMore,
      setStreamWindowEnd,
      setLoadedItemIds,
      setTotalCount: (nextTotal) => {
        totalCountRef.current = nextTotal;
        setTotalCount(nextTotal);
      },
      setError,
      streamSlice,
      fetchMoreIds: async (loadedCount) => {
        const result = await getCollectorService().items.queryIndex(
          filter,
          searchQuery,
          {
            offset: loadedCount,
            limit: DASHBOARD_PREFETCH_SIZE,
          },
          sort,
        );
        const page = mapIndexQueryResult(result);
        return { itemIds: page.itemIds, totalCount: page.totalCount };
      },
      reportError: reportServiceError,
    });
  }, [
    filter,
    isLoading,
    isLoadingMore,
    itemIds,
    searchQuery,
    setLoadedItemIds,
    setStreamWindowEnd,
    sort,
    streamEndOffset,
    streamSlice,
    totalCount,
  ]);

  return {
    loadMore,
    syncRepublishRef,
  };
}
