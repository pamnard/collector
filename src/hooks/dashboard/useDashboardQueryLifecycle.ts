import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
} from "react";
import type { DashboardItemSort, VaultIndexSyncStatus } from "@collector/api";
import {
  bodyStampsForOrderedIds,
  bodyStampsFromMap,
  coverMapsForPersistence,
  coverPathsFromMaps,
  orderedIds,
  snapshotToCacheEntry,
} from "../../lib/dashboard-commit";
import {
  createThrottledPublisher,
  mapIndexQueryResult,
} from "../../lib/dashboard-display";
import {
  buildDashboardQueryCacheEntry,
  readInitialDashboardCacheEntry,
  stateFromDashboardCacheEntry,
} from "../../lib/dashboard-query-load";
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
import {
  dashboardPerfActiveRunId,
  dashboardPerfBeginPhase,
  dashboardPerfEndPhase,
} from "../../lib/dashboard-perf";
import type { DashboardListState } from "./dashboard-list-state-types";
import { applyIndexPageAgainstListState } from "./apply-index-page-against-list";

/** Matches service `syncRepublishThrottleMs` for IndexPort-driven re-query (#367). */
const DASHBOARD_SYNC_REPUBLISH_MS = 500;

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
    committedBodyStampsRef,
    totalCountRef,
    committedItemsRef,
    committedThumbnailPathsRef,
    committedThumbnailStampsRef,
    committedThumbnailSizesRef,
    committedTotalCountRef,
    queryKeyRef,
    streamAbortRef,
    persistTimerRef,
    queryBusyRef,
    filterRef,
    searchQueryRef,
    sortRef,
    setItemsById,
    setTotalCount,
    setIsLoading,
    setIsLoadingMore,
    setError,
    setCommittedItems,
    setCommittedTotalCount,
    setCommittedHasMore,
    applyCacheEntryToState,
    commitWorkingToDisplay,
    setStreamWindowEnd,
    setLoadedItemIds,
    clearWorkingWindow,
    clearCommittedPaint,
  } = list;

  const prevIndexSyncStatusRef = useRef(indexSync.status);
  const syncRepublishRef = useRef<{
    schedule: () => void;
    flush: () => void;
    cancel: () => void;
  } | null>(null);

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
    if (queryKeyRef.current === queryKey) {
      return;
    }
    const prevCommitted = committedItemsRef.current.length;
    queryKeyRef.current = queryKey;

    setError(null);
    const warmed = readInitialDashboardCacheEntry({
      cacheKey: queryKey,
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
    if (warmed) {
      applyCacheEntryToState(warmed);
      setIsLoading(false);
      return;
    }

    // Keep committed paint until the new query commits — clearing here forces
    // grid-skeleton blank flash on every cold folder switch.
    clearWorkingWindow();
    if (prevCommitted === 0) {
      clearCommittedPaint();
    }
    setIsLoading(true);
  }, [
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

    const cached = getDashboardQueryCache(queryKey);
    setError(null);

    if (cached) {
      const working = stateFromDashboardCacheEntry(cached);
      setLoadedItemIds(working.itemIds);
      itemsByIdRef.current = working.itemsById;
      bodyStampsRef.current = working.bodyStamps;
      setItemsById(working.itemsById);
      totalCountRef.current = working.totalCount;
      setTotalCount(working.totalCount);
      setStreamWindowEnd(working.streamEndOffset);
      setIsLoading(false);
    } else {
      // Cache miss after invalidate: drop bodies so ids-same re-hydrates.
      itemsByIdRef.current = new Map();
      bodyStampsRef.current = new Map();
      setItemsById(new Map());
      if (committedItemsRef.current.length === 0) {
        setIsLoading(true);
        setLoadedItemIds([]);
        totalCountRef.current = 0;
        setTotalCount(0);
        setStreamWindowEnd(0);
      }
    }

    streamAbortRef.current?.abort();
    abortCoverFlight();

    const controller = new AbortController();

    const tryCommitAfterIndexPage = async () => {
      if (requestVersionRef.current !== requestVersion) {
        return;
      }
      try {
        // Cold first window: await covers, then one list+maps paint (#855).
        await commitWorkingToDisplay(requestVersion, { blockOnCovers: true });
      } catch (err: unknown) {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        reportServiceError("dashboard cover paths", err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (requestVersionRef.current === requestVersion) {
          const perfRunId = dashboardPerfActiveRunId();
          dashboardPerfBeginPhase(perfRunId, "loadingOff");
          setIsLoading(false);
          dashboardPerfEndPhase(perfRunId, "loadingOff");
          queryBusyRef.current = false;
        }
      }
    };

    void (async () => {
      try {
        if (controller.signal.aborted) {
          return;
        }
        const perfRunId = dashboardPerfActiveRunId();
        dashboardPerfBeginPhase(perfRunId, "queryIndex");
        const result = await getCollectorService().items.queryIndex(
          filter,
          searchQuery,
          { offset: 0, limit: DASHBOARD_PREFETCH_SIZE },
          sort,
        );
        dashboardPerfEndPhase(perfRunId, "queryIndex");
        if (
          controller.signal.aborted ||
          requestVersionRef.current !== requestVersion
        ) {
          return;
        }
        const page = mapIndexQueryResult(result);
        dashboardPerfBeginPhase(perfRunId, "applyIndexPage");
        await applyIndexPage(page, requestVersion);
        dashboardPerfEndPhase(perfRunId, "applyIndexPage");
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        if (page.offset === 0) {
          await tryCommitAfterIndexPage();
        }
      } catch (err: unknown) {
        if (
          controller.signal.aborted ||
          requestVersionRef.current !== requestVersion
        ) {
          return;
        }
        reportServiceError("dashboard index page", err);
        setError(err instanceof Error ? err.message : String(err));
        setIsLoading(false);
        queryBusyRef.current = false;
      }
    })();

    return () => {
      controller.abort();
      streamAbortRef.current?.abort();
      abortCoverFlight();
      if (requestVersionRef.current === requestVersion) {
        queryBusyRef.current = false;
      }
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

  // IndexPort-driven live refresh: replaces subscribeDashboardLoad vault sync listener.
  useEffect(() => {
    const publisher = createThrottledPublisher(() => {
      const requestVersion = requestVersionRef.current;
      const limit = Math.max(
        itemIdsRef.current.length,
        DASHBOARD_PREFETCH_SIZE,
      );
      void (async () => {
        try {
          const result = await getCollectorService().items.queryIndex(
            filterRef.current,
            searchQueryRef.current,
            { offset: 0, limit },
            sortRef.current,
          );
          if (requestVersionRef.current !== requestVersion) {
            return;
          }
          await applyIndexPage(mapIndexQueryResult(result), requestVersion);
          if (requestVersionRef.current !== requestVersion) {
            return;
          }
          await commitWorkingToDisplay(requestVersion, {
            blockOnCovers: false,
          });
        } catch (err: unknown) {
          if (requestVersionRef.current !== requestVersion) {
            return;
          }
          reportServiceError("dashboard sync republish", err);
        }
      })();
    }, DASHBOARD_SYNC_REPUBLISH_MS);
    syncRepublishRef.current = publisher;
    return () => {
      publisher.cancel();
      if (syncRepublishRef.current === publisher) {
        syncRepublishRef.current = null;
      }
    };
  }, [
    applyIndexPage,
    commitWorkingToDisplay,
  ]);

  useEffect(() => {
    const prev = prevIndexSyncStatusRef.current;
    prevIndexSyncStatusRef.current = indexSync.status;
    const active =
      indexSync.status === "running" || indexSync.status === "rebuilding";
    if (active) {
      syncRepublishRef.current?.schedule();
    }
    if (
      (prev === "running" || prev === "rebuilding") &&
      indexSync.status === "done"
    ) {
      syncRepublishRef.current?.flush();
    }
  }, [
    indexSync.status,
    indexSync.progress?.processed,
    indexSync.progress?.total,
    indexSync.metadataReady,
    indexSync.ftsReady,
  ]);

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
    // load-more / in-place stream growth after offset-0 commit settled
    const prevCommittedLen = committedItemsRef.current.length;
    setCommittedItems(workingItems);
    setCommittedTotalCount(totalCount);
    setCommittedHasMore(streamEndOffset < totalCount);
    committedItemsRef.current = workingItems;
    committedTotalCountRef.current = totalCount;
    committedBodyStampsRef.current = bodyStampsForOrderedIds(
      bodyStampsRef.current,
      orderedIds(workingItems),
    );
    // Grid no longer resolves covers — resolve when the window grows (#657).
    if (workingItems.length > prevCommittedLen) {
      void commitWorkingToDisplay(requestVersionRef.current);
    }
  }, [
    commitWorkingToDisplay,
    isLoading,
    workingItems,
    totalCount,
    streamEndOffset,
  ]);

  useEffect(() => {
    if (!vaultId || isLoading || !itemIds.length || !workingItems.length) {
      return;
    }

    persistTimerRef.current = setTimeout(() => {
      const session = getUiSession();
      const coverPaths = coverPathsFromMaps(
        committedThumbnailPathsRef.current,
        committedThumbnailStampsRef.current,
        committedThumbnailSizesRef.current,
      );
      void session.snapshot.persistDashboardSnapshot(
        session.snapshot.buildDashboardSnapshot({
          vaultId,
          filter,
          search: searchQuery,
          sort,
          itemIds,
          items: workingItems,
          totalCount,
          streamEndOffset,
          coverPaths,
          bodyStamps: bodyStampsFromMap(bodyStampsRef.current),
        }),
      );
      setDashboardQueryCache(
        queryKey,
        buildDashboardQueryCacheEntry({
          itemIds,
          itemsById,
          bodyStamps: bodyStampsRef.current,
          streamEndOffset,
          totalCount,
          ...coverMapsForPersistence(
            committedThumbnailPathsRef.current,
            committedThumbnailStampsRef.current,
            committedThumbnailSizesRef.current,
          ),
        }),
      );
    }, 400);

    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }
    };
  }, [
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
