import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ItemFile } from "@collector/shared";
import type { DashboardItemSort } from "@collector/api";
import { useAppSettings } from "../context/AppSettingsContext";
import {
  coverNeedsResolve,
  coverPathsFromMaps,
  bodyStampsFromMap,
  zipIdStamps,
  itemCoverStamp,
  itemsBodiesEqual,
  intersectCommittedWithPageIds,
  mergeCommittedThumbnailPaths,
  mergeCommittedThumbnailStamps,
  orderedIds,
  pruneItemIdFromDashboardLists,
  shouldSkipEmptyCommit,
  snapshotToCacheEntry,
} from "../lib/dashboard-commit";
import {
  createCoverPathCommitBatcher,
  type CoverPathCommitBatcher,
} from "../lib/cover-path-commit-batcher";
import {
  collectHydratedItems,
  createThrottledPublisher,
  isDashboardPrefetchWindowReady,
  itemIdsEqual,
  mapIndexQueryResult,
  mergeStreamedItemsById,
  orderDashboardItems,
  shouldApplyDashboardStreamBatch,
} from "../lib/dashboard-display";
import {
  nextStreamWindow,
  planApplyOffsetZeroPage,
  planLoadMore,
} from "../lib/dashboard-query-window";
import { resolveDashboardCoverPathsProgressive } from "../lib/preload-dashboard-covers";
import { navFilterKey, type NavFilter } from "../types/ui";
import {
  DASHBOARD_PREFETCH_SIZE,
  getCollectorService,
  getUiSession,
} from "../services/collector-client";
import {
  dashboardQueryCacheKey,
  getDashboardQueryCache,
  removeItemIdFromDashboardQueryCache,
  setDashboardQueryCache,
  type DashboardQueryCacheEntry,
} from "../services/dashboard-query-cache";
import { reportServiceError } from "../services/runtime-error";
import { useVaultIndexSyncStatus } from "./useVaultIndexSyncStatus";

export { DASHBOARD_PREFETCH_SIZE } from "../services/collector-client";

export const DEFAULT_DASHBOARD_SORT: DashboardItemSort = {
  key: "created_at",
  dir: "desc",
};

/** Matches service `syncRepublishThrottleMs` for IndexPort-driven re-query (#367). */
const DASHBOARD_SYNC_REPUBLISH_MS = 500;

interface UseDashboardItemsResult {
  items: ItemFile[];
  /** Resolved cover paths (null = no file cover). Decode is per-card. */
  thumbnailPaths: Map<string, string | null>;
  /** Freshness stamps for cover paths (`thumbnail:updated_at`). */
  thumbnailStamps: Map<string, string>;
  totalCount: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => void;
  /** Drop a deleted id from committed/working lists and query cache immediately. */
  pruneItem: (itemId: string) => void;
}

function readInitialCacheEntry(
  filter: NavFilter,
  searchQuery: string,
  sort: DashboardItemSort,
  vaultId: string | null | undefined,
): DashboardQueryCacheEntry | null {
  const key = dashboardQueryCacheKey(
    navFilterKey(filter),
    searchQuery,
    sort.key,
    sort.dir,
  );
  const cached = getDashboardQueryCache(key);
  if (cached) {
    return cached;
  }

  if (!vaultId) {
    return null;
  }
  const warm = getUiSession().snapshot.peekMatchingDashboardSnapshot({
    vaultId,
    filter,
    search: searchQuery,
    sort,
  });
  if (!warm) {
    return null;
  }
  const entry = snapshotToCacheEntry(warm);
  setDashboardQueryCache(key, entry);
  return getDashboardQueryCache(key);
}

export function useDashboardItems(
  filter: NavFilter,
  searchQuery: string,
  vaultRevision: number,
  sort: DashboardItemSort = DEFAULT_DASHBOARD_SORT,
): UseDashboardItemsResult {
  const { settings } = useAppSettings();

  const [initial] = useState(() =>
    readInitialCacheEntry(
      filter,
      searchQuery,
      sort,
      settings.active_vault_id,
    ),
  );
  const [itemIds, setItemIds] = useState(() => initial?.itemIds ?? []);
  const [itemsById, setItemsById] = useState(
    () => initial?.itemsById ?? new Map<string, ItemFile>(),
  );
  const [streamEndOffset, setStreamEndOffset] = useState(
    () => initial?.streamEndOffset ?? 0,
  );
  const [totalCount, setTotalCount] = useState(() => initial?.totalCount ?? 0);
  const [isLoading, setIsLoading] = useState(() => initial === null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committedItems, setCommittedItems] = useState(() =>
    initial
      ? orderDashboardItems(
          initial.itemIds,
          initial.itemsById,
          initial.streamEndOffset,
        )
      : [],
  );
  const [committedThumbnailPaths, setCommittedThumbnailPaths] = useState<
    Map<string, string | null>
  >(() => new Map(initial?.thumbnailPaths ?? []));
  const [committedThumbnailStamps, setCommittedThumbnailStamps] = useState<
    Map<string, string>
  >(() => new Map(initial?.thumbnailStamps ?? []));
  const [committedTotalCount, setCommittedTotalCount] = useState(
    () => initial?.totalCount ?? 0,
  );
  const [committedHasMore, setCommittedHasMore] = useState(() => {
    if (!initial) {
      return false;
    }
    return initial.streamEndOffset < initial.totalCount;
  });

  const indexSync = useVaultIndexSyncStatus();
  const requestVersionRef = useRef(0);
  const streamEndOffsetRef = useRef(initial?.streamEndOffset ?? 0);
  const itemIdsRef = useRef<string[]>(initial?.itemIds ?? []);
  const itemsByIdRef = useRef<Map<string, ItemFile>>(
    initial?.itemsById ?? new Map(),
  );
  const bodyStampsRef = useRef<Map<string, string>>(
    initial?.bodyStamps ?? new Map(),
  );
  const totalCountRef = useRef(initial?.totalCount ?? 0);
  const committedItemsRef = useRef(committedItems);
  const committedThumbnailPathsRef = useRef(committedThumbnailPaths);
  const committedThumbnailStampsRef = useRef(committedThumbnailStamps);
  const committedTotalCountRef = useRef(committedTotalCount);
  const queryKeyRef = useRef(
    dashboardQueryCacheKey(
      navFilterKey(filter),
      searchQuery,
      sort.key,
      sort.dir,
    ),
  );
  const streamAbortRef = useRef<AbortController | null>(null);
  const coverFlightRef = useRef<{
    version: number;
    promise: Promise<void>;
    controller: AbortController;
    batcher: CoverPathCommitBatcher;
  } | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryBusyRef = useRef(false);
  const filterRef = useRef(filter);
  const searchQueryRef = useRef(searchQuery);
  const sortRef = useRef(sort);
  filterRef.current = filter;
  searchQueryRef.current = searchQuery;
  sortRef.current = sort;
  const prevIndexSyncStatusRef = useRef(indexSync.status);
  const syncRepublishRef = useRef<{
    schedule: () => void;
    flush: () => void;
    cancel: () => void;
  } | null>(null);

  const isIndexingEmptyGrid =
    (indexSync.status === "running" || indexSync.status === "rebuilding") &&
    committedTotalCount === 0 &&
    committedItems.length === 0;

  const workingItems = useMemo(
    () => orderDashboardItems(itemIds, itemsById, streamEndOffset),
    [itemIds, itemsById, streamEndOffset],
  );

  useEffect(() => {
    itemsByIdRef.current = itemsById;
  }, [itemsById]);

  useEffect(() => {
    totalCountRef.current = totalCount;
  }, [totalCount]);

  useEffect(() => {
    committedItemsRef.current = committedItems;
  }, [committedItems]);

  useEffect(() => {
    committedThumbnailPathsRef.current = committedThumbnailPaths;
  }, [committedThumbnailPaths]);

  useEffect(() => {
    committedThumbnailStampsRef.current = committedThumbnailStamps;
  }, [committedThumbnailStamps]);

  useEffect(() => {
    committedTotalCountRef.current = committedTotalCount;
  }, [committedTotalCount]);

  const writeQueryCache = useCallback(
    (
      ids: string[],
      byId: Map<string, ItemFile>,
      end: number,
      nextTotal: number,
    ) => {
      setDashboardQueryCache(queryKeyRef.current, {
        itemIds: [...ids],
        itemsById: new Map(byId),
        bodyStamps: new Map(bodyStampsRef.current),
        streamEndOffset: end,
        totalCount: nextTotal,
        thumbnailPaths: new Map(committedThumbnailPathsRef.current),
        thumbnailStamps: new Map(committedThumbnailStampsRef.current),
        updatedAt: Date.now(),
      });
    },
    [],
  );

  const applyCacheEntryToState = useCallback((entry: DashboardQueryCacheEntry) => {
    itemIdsRef.current = entry.itemIds;
    itemsByIdRef.current = entry.itemsById;
    bodyStampsRef.current = new Map(entry.bodyStamps);
    streamEndOffsetRef.current = entry.streamEndOffset;
    totalCountRef.current = entry.totalCount;
    setItemIds(entry.itemIds);
    setItemsById(entry.itemsById);
    setStreamEndOffset(entry.streamEndOffset);
    setTotalCount(entry.totalCount);
    const ordered = orderDashboardItems(
      entry.itemIds,
      entry.itemsById,
      entry.streamEndOffset,
    );
    const paths = new Map(entry.thumbnailPaths);
    const stamps = new Map(entry.thumbnailStamps);
    setCommittedItems(ordered);
    setCommittedThumbnailPaths(paths);
    setCommittedThumbnailStamps(stamps);
    setCommittedTotalCount(entry.totalCount);
    setCommittedHasMore(entry.streamEndOffset < entry.totalCount);
    committedItemsRef.current = ordered;
    committedThumbnailPathsRef.current = paths;
    committedThumbnailStampsRef.current = stamps;
    committedTotalCountRef.current = entry.totalCount;
  }, []);

  const commitWorkingToDisplay = useCallback(
    async (requestVersion: number) => {
      if (requestVersionRef.current !== requestVersion) {
        return;
      }

      const ids = itemIdsRef.current;
      const byId = itemsByIdRef.current;
      const end = streamEndOffsetRef.current;

      if (!isDashboardPrefetchWindowReady(ids, byId, end)) {
        console.warn(
          "[dashboard] prefetch window incomplete at commit; revealing anyway",
          {
            idCount: ids.length,
            bodyCount: byId.size,
            streamEndOffset: end,
          },
        );
      }

      const ordered = orderDashboardItems(ids, byId, end);
      const prevItems = committedItemsRef.current;
      const nextTotal = totalCountRef.current;
      if (
        shouldSkipEmptyCommit(ordered.length, prevItems.length, nextTotal)
      ) {
        return;
      }

      const prevPaths = committedThumbnailPathsRef.current;
      const prevStamps = committedThumbnailStampsRef.current;
      const prevTotal = committedTotalCountRef.current;
      const nextOrderedIds = orderedIds(ordered);
      const idsMatch = itemIdsEqual(orderedIds(prevItems), nextOrderedIds);
      const itemsUnchanged =
        idsMatch &&
        prevTotal === nextTotal &&
        itemsBodiesEqual(prevItems, ordered);

      if (!itemsUnchanged) {
        const prunedPaths = mergeCommittedThumbnailPaths(
          prevPaths,
          new Map(),
          nextOrderedIds,
        );
        const prunedStamps = mergeCommittedThumbnailStamps(
          prevStamps,
          new Map(),
          nextOrderedIds,
        );
        setCommittedItems(ordered);
        setCommittedTotalCount(nextTotal);
        setCommittedHasMore(end < nextTotal);
        setCommittedThumbnailPaths(prunedPaths);
        setCommittedThumbnailStamps(prunedStamps);
        committedItemsRef.current = ordered;
        committedTotalCountRef.current = nextTotal;
        committedThumbnailPathsRef.current = prunedPaths;
        committedThumbnailStampsRef.current = prunedStamps;
      }

      writeQueryCache(ids, byId, end, nextTotal);

      const collectNeedsResolve = () =>
        ordered.filter((item) =>
          coverNeedsResolve(
            item,
            committedThumbnailPathsRef.current,
            committedThumbnailStampsRef.current,
          ),
        );

      // Same-version waiters share one flight so sync republish does not abort
      // in-flight covers (#657).
      while (true) {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        const needsResolve = collectNeedsResolve();
        if (!needsResolve.length) {
          return;
        }

        const existingFlight = coverFlightRef.current;
        if (existingFlight && existingFlight.version === requestVersion) {
          await existingFlight.promise;
          continue;
        }

        existingFlight?.batcher.cancel();
        existingFlight?.controller.abort();

        const coverController = new AbortController();
        const stampById = new Map(
          needsResolve.map((item) => [item.id, itemCoverStamp(item)]),
        );
        const coverBatcher = createCoverPathCommitBatcher({
          requestVersion,
          getRequestVersion: () => requestVersionRef.current,
          isAborted: () => coverController.signal.aborted,
          getOrderedIds: () => nextOrderedIds,
          getPaths: () => committedThumbnailPathsRef.current,
          getStamps: () => committedThumbnailStampsRef.current,
          commit: (mergedPaths, mergedStamps) => {
            setCommittedThumbnailPaths(mergedPaths);
            setCommittedThumbnailStamps(mergedStamps);
            committedThumbnailPathsRef.current = mergedPaths;
            committedThumbnailStampsRef.current = mergedStamps;
          },
        });

        const flightPromise = (async () => {
          await resolveDashboardCoverPathsProgressive(needsResolve, {
            signal: coverController.signal,
            onResolved: (id, path) => {
              const stamp = stampById.get(id);
              if (stamp === undefined) {
                return;
              }
              coverBatcher.enqueue(id, path, stamp);
            },
          });
          coverBatcher.flush();
        })();

        coverFlightRef.current = {
          version: requestVersion,
          promise: flightPromise,
          controller: coverController,
          batcher: coverBatcher,
        };
        try {
          await flightPromise;
        } finally {
          if (coverFlightRef.current?.promise === flightPromise) {
            coverFlightRef.current = null;
          }
        }
        break;
      }

      if (requestVersionRef.current !== requestVersion) {
        return;
      }

      writeQueryCache(ids, byId, end, nextTotal);
    },
    [writeQueryCache],
  );

  const streamSlice = useCallback(
    async (
      ids: string[],
      offset: number,
      limit: number,
      requestVersion: number,
    ): Promise<void> => {
      // Stale callers (Strict Mode / superseded query) must not abort the
      // in-flight stream owned by a newer requestVersion.
      if (requestVersion !== requestVersionRef.current) {
        return;
      }
      if (!ids.length || offset >= ids.length || limit <= 0) {
        return;
      }

      streamAbortRef.current?.abort();
      const controller = new AbortController();
      streamAbortRef.current = controller;

      const pending = new Map<string, ItemFile>();
      const slice = ids.slice(offset, offset + limit);
      await collectHydratedItems(
        getCollectorService().items.hydrate(slice, { signal: controller.signal }),
        (item) => {
          if (requestVersionRef.current !== requestVersion) {
            return;
          }
          pending.set(item.id, item);
        },
      );

      if (
        !shouldApplyDashboardStreamBatch(
          requestVersionRef.current,
          requestVersion,
          pending.size,
        )
      ) {
        return;
      }

      setItemsById((current) => {
        const next = mergeStreamedItemsById(current, pending);
        itemsByIdRef.current = next;
        return next;
      });
    },
    [],
  );

  const setStreamWindowEnd = useCallback((end: number) => {
    streamEndOffsetRef.current = end;
    setStreamEndOffset(end);
  }, []);

  const setLoadedItemIds = useCallback((nextIds: string[]) => {
    itemIdsRef.current = nextIds;
    setItemIds(nextIds);
  }, []);

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
      totalCountRef.current = page.totalCount;
      setTotalCount(page.totalCount);

      if (page.offset !== 0) {
        return;
      }

      const plan = planApplyOffsetZeroPage({
        pageItemIds: page.itemIds,
        pageStamps: page.stamps,
        previousIds: itemIdsRef.current,
        previousStreamEnd: streamEndOffsetRef.current,
        prefetchSize: DASHBOARD_PREFETCH_SIZE,
        itemsByIdHas: (id) => itemsByIdRef.current.has(id),
        cachedStampFor: (id) => bodyStampsRef.current.get(id),
      });

      if (plan.kind === "empty") {
        setLoadedItemIds([]);
        bodyStampsRef.current = new Map();
        setStreamWindowEnd(0);
        setCommittedItems([]);
        committedItemsRef.current = [];
        setCommittedTotalCount(0);
        committedTotalCountRef.current = 0;
        setCommittedHasMore(false);
        const emptyThumbs = new Map<string, string | null>();
        const emptyStamps = new Map<string, string>();
        setCommittedThumbnailPaths(emptyThumbs);
        setCommittedThumbnailStamps(emptyStamps);
        committedThumbnailPathsRef.current = emptyThumbs;
        committedThumbnailStampsRef.current = emptyStamps;
        return;
      }

      const pageStampMap = zipIdStamps(page.itemIds, page.stamps);

      const streamWindow = async () => {
        await streamSlice(
          page.itemIds,
          0,
          plan.preservedEnd,
          requestVersion,
        );
        if (
          !isDashboardPrefetchWindowReady(
            itemIdsRef.current,
            itemsByIdRef.current,
            streamEndOffsetRef.current,
          )
        ) {
          // First stream often races with effect abort on query switch — retry once.
          await streamSlice(
            page.itemIds,
            0,
            plan.preservedEnd,
            requestVersion,
          );
        }
        if (requestVersionRef.current === requestVersion) {
          bodyStampsRef.current = pageStampMap;
        }
      };

      if (plan.kind === "ids-changed") {
        setLoadedItemIds(page.itemIds);
        const kept = new Map<string, ItemFile>();
        for (const id of plan.idsToKeepBodies) {
          const existing = itemsByIdRef.current.get(id);
          if (existing) {
            kept.set(id, existing);
          }
        }
        itemsByIdRef.current = kept;
        setItemsById(kept);
        setStreamWindowEnd(plan.preservedEnd);

        const nextCommitted = intersectCommittedWithPageIds(
          committedItemsRef.current,
          page.itemIds,
        );
        const nextCommittedIds = nextCommitted.map((item) => item.id);
        setCommittedItems(nextCommitted);
        committedItemsRef.current = nextCommitted;
        setCommittedTotalCount(page.totalCount);
        committedTotalCountRef.current = page.totalCount;
        setCommittedHasMore(plan.preservedEnd < page.totalCount);
        const prunedPaths = mergeCommittedThumbnailPaths(
          committedThumbnailPathsRef.current,
          new Map(),
          nextCommittedIds,
        );
        const prunedStamps = mergeCommittedThumbnailStamps(
          committedThumbnailStampsRef.current,
          new Map(),
          nextCommittedIds,
        );
        setCommittedThumbnailPaths(prunedPaths);
        setCommittedThumbnailStamps(prunedStamps);
        committedThumbnailPathsRef.current = prunedPaths;
        committedThumbnailStampsRef.current = prunedStamps;

        await streamWindow();
        return;
      }

      setStreamWindowEnd(plan.preservedEnd);
      if (plan.needsStream) {
        await streamWindow();
      } else {
        bodyStampsRef.current = pageStampMap;
      }
    },
    [setLoadedItemIds, setStreamWindowEnd, streamSlice],
  );

  // Object folder/tag filters are new each render from navFilterFromSetting;
  // depend on filterKey only (#82). Do not re-add `filter` to deps (#114 / #78 regression).
  const filterKey = navFilterKey(filter);
  const vaultId = settings.active_vault_id ?? null;
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

    const cached = getDashboardQueryCache(queryKey);
    setError(null);
    if (cached) {
      applyCacheEntryToState(cached);
      setIsLoading(false);
      return;
    }

    if (vaultId) {
      const warm = getUiSession().snapshot.peekMatchingDashboardSnapshot({
        vaultId,
        filter,
        search: searchQuery,
        sort,
      });
      if (warm) {
        const entry = snapshotToCacheEntry(warm);
        setDashboardQueryCache(queryKey, entry);
        applyCacheEntryToState(entry);
        setIsLoading(false);
        return;
      }
    }

    // Keep committed paint until the new query commits — clearing here forces
    // grid-skeleton blank flash on every cold folder switch.
    itemIdsRef.current = [];
    itemsByIdRef.current = new Map();
    bodyStampsRef.current = new Map();
    streamEndOffsetRef.current = 0;
    totalCountRef.current = 0;
    setItemIds([]);
    setItemsById(new Map());
    setStreamEndOffset(0);
    setTotalCount(0);
    if (prevCommitted === 0) {
      setCommittedItems([]);
      setCommittedThumbnailPaths(new Map());
      setCommittedThumbnailStamps(new Map());
      setCommittedTotalCount(0);
      setCommittedHasMore(false);
      committedItemsRef.current = [];
      committedThumbnailPathsRef.current = new Map();
      committedThumbnailStampsRef.current = new Map();
      committedTotalCountRef.current = 0;
    }
    setIsLoading(true);
  }, [applyCacheEntryToState, filter, queryKey, searchQuery, sort, vaultId]);

  useEffect(() => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    queryKeyRef.current = queryKey;
    queryBusyRef.current = true;

    const cached = getDashboardQueryCache(queryKey);
    setError(null);

    if (cached) {
      setLoadedItemIds(cached.itemIds);
      itemsByIdRef.current = cached.itemsById;
      bodyStampsRef.current = new Map(cached.bodyStamps);
      setItemsById(cached.itemsById);
      totalCountRef.current = cached.totalCount;
      setTotalCount(cached.totalCount);
      setStreamWindowEnd(cached.streamEndOffset);
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
    coverFlightRef.current?.batcher.cancel();
    coverFlightRef.current?.controller.abort();
    coverFlightRef.current = null;

    const controller = new AbortController();

    const tryCommitAfterIndexPage = async () => {
      if (requestVersionRef.current !== requestVersion) {
        return;
      }
      try {
        await commitWorkingToDisplay(requestVersion);
      } catch (err: unknown) {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        reportServiceError("dashboard cover paths", err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (requestVersionRef.current === requestVersion) {
          setIsLoading(false);
          queryBusyRef.current = false;
        }
      }
    };

    void (async () => {
      try {
        if (controller.signal.aborted) {
          return;
        }
        const result = await getCollectorService().items.queryIndex(
          filter,
          searchQuery,
          { offset: 0, limit: DASHBOARD_PREFETCH_SIZE },
          sort,
        );
        if (
          controller.signal.aborted ||
          requestVersionRef.current !== requestVersion
        ) {
          return;
        }
        const page = mapIndexQueryResult(result);
        await applyIndexPage(page, requestVersion);
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
      coverFlightRef.current?.batcher.cancel();
      coverFlightRef.current?.controller.abort();
      coverFlightRef.current = null;
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
    sort,
    vaultId,
    vaultRevision,
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
          await commitWorkingToDisplay(requestVersion);
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
  }, [applyIndexPage, commitWorkingToDisplay]);

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
    // Grid no longer resolves covers — resolve when the window grows (#657).
    if (workingItems.length > prevCommittedLen) {
      void commitWorkingToDisplay(requestVersionRef.current);
    }
  }, [commitWorkingToDisplay, isLoading, workingItems, totalCount, streamEndOffset]);

  useEffect(() => {
    if (!vaultId || isLoading || !itemIds.length || !workingItems.length) {
      return;
    }

    persistTimerRef.current = setTimeout(() => {
      const session = getUiSession();
      const coverPaths = coverPathsFromMaps(
        committedThumbnailPathsRef.current,
        committedThumbnailStampsRef.current,
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
      setDashboardQueryCache(queryKey, {
        itemIds: [...itemIds],
        itemsById: new Map(itemsById),
        bodyStamps: new Map(bodyStampsRef.current),
        streamEndOffset,
        totalCount,
        thumbnailPaths: new Map(committedThumbnailPathsRef.current),
        thumbnailStamps: new Map(committedThumbnailStampsRef.current),
        updatedAt: Date.now(),
      });
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
    const plan = planLoadMore({
      isLoading,
      isLoadingMore,
      streamEndOffset,
      loadedCount: itemIds.length,
      totalCount,
      prefetchSize: DASHBOARD_PREFETCH_SIZE,
    });
    if (plan.kind === "noop") {
      return;
    }

    const requestVersion = requestVersionRef.current;
    const loadedCount = itemIds.length;
    setIsLoadingMore(true);

    const streamNextWindow = (ids: string[]) => {
      const { offset, limit, nextEnd } = nextStreamWindow(
        streamEndOffsetRef.current,
        ids.length,
        DASHBOARD_PREFETCH_SIZE,
      );
      setStreamWindowEnd(nextEnd);

      void streamSlice(ids, offset, limit, requestVersion)
        .catch((err: unknown) => {
          if (requestVersionRef.current !== requestVersion) {
            return;
          }
          reportServiceError("dashboard load more", err);
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (requestVersionRef.current === requestVersion) {
            setIsLoadingMore(false);
          }
        });
    };

    if (plan.kind === "fetch-ids-then-stream") {
      void getCollectorService().items
        .queryIndex(
          filter,
          searchQuery,
          {
            offset: loadedCount,
            limit: DASHBOARD_PREFETCH_SIZE,
          },
          sort,
        )
        .then((result) => {
          if (requestVersionRef.current !== requestVersion) {
            return;
          }
          const page = mapIndexQueryResult(result);
          totalCountRef.current = page.totalCount;
          setTotalCount(page.totalCount);
          const mergedIds = [...itemIdsRef.current, ...page.itemIds];
          setLoadedItemIds(mergedIds);
          streamNextWindow(mergedIds);
        })
        .catch((err: unknown) => {
          if (requestVersionRef.current !== requestVersion) {
            return;
          }
          reportServiceError("dashboard load more ids", err);
          setError(err instanceof Error ? err.message : String(err));
          setIsLoadingMore(false);
        });
      return;
    }

    streamNextWindow(itemIds);
  }, [
    filter,
    filterKey,
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

  const showSkeleton =
    (isLoading && committedItems.length === 0) || isIndexingEmptyGrid;

  const pruneItem = useCallback(
    (itemId: string) => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }

      const pruned = pruneItemIdFromDashboardLists(itemId, {
        itemIds: itemIdsRef.current,
        itemsById: itemsByIdRef.current,
        bodyStamps: bodyStampsRef.current,
        thumbnailPaths: committedThumbnailPathsRef.current,
        thumbnailStamps: committedThumbnailStampsRef.current,
        streamEndOffset: streamEndOffsetRef.current,
        totalCount: totalCountRef.current,
        committedItems: committedItemsRef.current,
        committedTotalCount: committedTotalCountRef.current,
      });

      removeItemIdFromDashboardQueryCache(itemId);

      if (!pruned.removed) {
        return;
      }

      itemIdsRef.current = pruned.itemIds;
      itemsByIdRef.current = pruned.itemsById;
      bodyStampsRef.current = pruned.bodyStamps;
      streamEndOffsetRef.current = pruned.streamEndOffset;
      totalCountRef.current = pruned.totalCount;
      committedItemsRef.current = pruned.committedItems;
      committedTotalCountRef.current = pruned.committedTotalCount;
      committedThumbnailPathsRef.current = pruned.thumbnailPaths;
      committedThumbnailStampsRef.current = pruned.thumbnailStamps;

      setItemIds(pruned.itemIds);
      setItemsById(pruned.itemsById);
      setStreamEndOffset(pruned.streamEndOffset);
      setTotalCount(pruned.totalCount);
      setCommittedItems(pruned.committedItems);
      setCommittedTotalCount(pruned.committedTotalCount);
      setCommittedHasMore(
        pruned.streamEndOffset < pruned.committedTotalCount,
      );
      setCommittedThumbnailPaths(pruned.thumbnailPaths);
      setCommittedThumbnailStamps(pruned.thumbnailStamps);

      writeQueryCache(
        pruned.itemIds,
        pruned.itemsById,
        pruned.streamEndOffset,
        pruned.totalCount,
      );
    },
    [writeQueryCache],
  );

  return {
    items: committedItems,
    thumbnailPaths: committedThumbnailPaths,
    thumbnailStamps: committedThumbnailStamps,
    totalCount: committedTotalCount,
    isLoading: showSkeleton,
    isLoadingMore,
    hasMore: committedHasMore,
    error,
    loadMore,
    pruneItem,
  };
}
