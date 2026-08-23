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
  applyDashboardListSnapshot,
  coverPathsFromMaps,
  bodyStampsFromMap,
  itemsBodiesEqual,
  intersectCommittedWithPageIdsHoldPaint,
  mergeCommittedThumbnailPaths,
  mergeCommittedThumbnailStamps,
  orderedIds,
  pruneItemIdFromDashboardLists,
  shouldSkipEmptyCommit,
  snapshotToCacheEntry,
  type DashboardListSnapshot,
} from "../lib/dashboard-commit";
import {
  createThrottledPublisher,
  isDashboardPrefetchWindowReady,
  itemIdsEqual,
  mapIndexQueryResult,
  orderDashboardItems,
} from "../lib/dashboard-display";
import {
  runCoverPathFlight,
  type CoverFlightSlot,
} from "../lib/dashboard-cover-flight";
import {
  buildDashboardQueryCacheEntry,
  readInitialDashboardCacheEntry,
  stateFromDashboardCacheEntry,
} from "../lib/dashboard-query-load";
import {
  applyDashboardIndexPage,
  mergePendingIntoItemsById,
  runDashboardLoadMore,
  streamDashboardSlice,
} from "../lib/dashboard-stream";
import { resolveDashboardCoverPathsProgressive } from "../lib/preload-dashboard-covers";
import { navFilterKey, type NavFilter } from "../types/ui";
import {
  DASHBOARD_PREFETCH_SIZE,
  getCollectorService,
  getUiSession,
} from "../services/collector-client";
import {
  applyDashboardQueryCacheCoverFlightPatch,
  dashboardQueryCacheKey,
  getDashboardQueryCache,
  removeItemIdFromDashboardQueryCache,
  setDashboardQueryCache,
  type DashboardQueryCacheEntry,
} from "../services/dashboard-query-cache";
import { reportServiceError } from "../services/runtime-error";
import { useVaultIndexSyncStatus } from "./useVaultIndexSyncStatus";
import { dashboardLiveActionForEvent } from "../lib/vault-presentation-affects";
import { itemIdToPruneFromPresentationEvent } from "../lib/presentation-prune-item-id";
import type { VaultPresentationChangedPayload } from "@collector/api";
import {
  dashboardPerfActiveRunId,
  dashboardPerfBeginPhase,
  dashboardPerfEndPhase,
  dashboardPerfNoteIntersect,
  dashboardPerfNoteItemCount,
} from "../lib/dashboard-perf";

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
  /** Scoped live updates from vaultPresentationChanged (#756). */
  applyPresentationEvents: (
    events: VaultPresentationChangedPayload[],
  ) => void;
}

function readInitialCacheEntry(
  filter: NavFilter,
  searchQuery: string,
  sort: DashboardItemSort,
  vaultId: string | null | undefined,
): DashboardQueryCacheEntry | null {
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
  const coverFlightRef = useRef<CoverFlightSlot>(null);
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
      setDashboardQueryCache(
        queryKeyRef.current,
        buildDashboardQueryCacheEntry({
          itemIds: ids,
          itemsById: byId,
          bodyStamps: bodyStampsRef.current,
          streamEndOffset: end,
          totalCount: nextTotal,
          thumbnailPaths: committedThumbnailPathsRef.current,
          thumbnailStamps: committedThumbnailStampsRef.current,
        }),
      );
    },
    [],
  );

  /** Single path for working + committed + refs (#655). */
  const applyListSnapshot = useCallback((snapshot: DashboardListSnapshot) => {
    applyDashboardListSnapshot(snapshot, {
      setItemIds: (ids) => {
        itemIdsRef.current = ids;
        setItemIds(ids);
      },
      setItemsById: (byId) => {
        itemsByIdRef.current = byId;
        setItemsById(byId);
      },
      setBodyStamps: (stamps) => {
        bodyStampsRef.current = stamps;
      },
      setStreamEndOffset: (end) => {
        streamEndOffsetRef.current = end;
        setStreamEndOffset(end);
      },
      setTotalCount: (nextTotal) => {
        totalCountRef.current = nextTotal;
        setTotalCount(nextTotal);
      },
      setCommittedItems: (items) => {
        committedItemsRef.current = items;
        setCommittedItems(items);
      },
      setCommittedTotalCount: (nextTotal) => {
        committedTotalCountRef.current = nextTotal;
        setCommittedTotalCount(nextTotal);
      },
      setCommittedHasMore,
      setCommittedThumbnailPaths: (paths) => {
        committedThumbnailPathsRef.current = paths;
        setCommittedThumbnailPaths(paths);
      },
      setCommittedThumbnailStamps: (stamps) => {
        committedThumbnailStampsRef.current = stamps;
        setCommittedThumbnailStamps(stamps);
      },
    });
  }, []);

  const applyCacheEntryToState = useCallback(
    (entry: DashboardQueryCacheEntry) => {
      const next = stateFromDashboardCacheEntry(entry);
      applyListSnapshot({
        itemIds: next.itemIds,
        itemsById: next.itemsById,
        bodyStamps: next.bodyStamps,
        streamEndOffset: next.streamEndOffset,
        totalCount: next.totalCount,
        committedItems: next.ordered,
        committedTotalCount: next.totalCount,
        thumbnailPaths: next.thumbnailPaths,
        thumbnailStamps: next.thumbnailStamps,
      });
    },
    [applyListSnapshot],
  );

  const commitWorkingToDisplay = useCallback(
    async (
      requestVersion: number,
      options?: { blockOnCovers?: boolean },
    ) => {
      if (requestVersionRef.current !== requestVersion) {
        return;
      }

      const blockOnCovers = options?.blockOnCovers ?? false;

      const ids = itemIdsRef.current;
      const byId = itemsByIdRef.current;
      const end = streamEndOffsetRef.current;
      const cacheKeyForFlight = queryKeyRef.current;

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
        const perfRunId = dashboardPerfActiveRunId();
        dashboardPerfBeginPhase(perfRunId, "commitList");
        setCommittedItems(ordered);
        setCommittedTotalCount(nextTotal);
        setCommittedHasMore(end < nextTotal);
        setCommittedThumbnailPaths(prunedPaths);
        setCommittedThumbnailStamps(prunedStamps);
        committedItemsRef.current = ordered;
        committedTotalCountRef.current = nextTotal;
        committedThumbnailPathsRef.current = prunedPaths;
        committedThumbnailStampsRef.current = prunedStamps;
        dashboardPerfEndPhase(perfRunId, "commitList");
        dashboardPerfNoteItemCount(perfRunId, ordered.length);
      }

      writeQueryCache(ids, byId, end, nextTotal);

      const perfRunId = dashboardPerfActiveRunId();
      dashboardPerfBeginPhase(perfRunId, "coverFlight");
      const coverFlight = runCoverPathFlight({
        requestVersion,
        getRequestVersion: () => requestVersionRef.current,
        orderedItems: ordered,
        getOrderedIds: () => nextOrderedIds,
        getPaths: () => committedThumbnailPathsRef.current,
        getStamps: () => committedThumbnailStampsRef.current,
        commit: (mergedPaths, mergedStamps) => {
          const result = applyDashboardQueryCacheCoverFlightPatch({
            flightKey: cacheKeyForFlight,
            flightVersion: requestVersion,
            getLiveKey: () => queryKeyRef.current,
            getLiveVersion: () => requestVersionRef.current,
            thumbnailPaths: mergedPaths,
            thumbnailStamps: mergedStamps,
            rewriteFull: () => {
              setDashboardQueryCache(
                cacheKeyForFlight,
                buildDashboardQueryCacheEntry({
                  itemIds: ids,
                  itemsById: byId,
                  bodyStamps: bodyStampsRef.current,
                  streamEndOffset: end,
                  totalCount: nextTotal,
                  thumbnailPaths: mergedPaths,
                  thumbnailStamps: mergedStamps,
                }),
              );
            },
          });
          if (result === "skipped") {
            return;
          }
          setCommittedThumbnailPaths(mergedPaths);
          setCommittedThumbnailStamps(mergedStamps);
          committedThumbnailPathsRef.current = mergedPaths;
          committedThumbnailStampsRef.current = mergedStamps;
        },
        getFlight: () => coverFlightRef.current,
        setFlight: (next) => {
          coverFlightRef.current = next;
        },
        resolveProgressive: resolveDashboardCoverPathsProgressive,
      });
      const endCoverPerf = () => {
        dashboardPerfEndPhase(perfRunId, "coverFlight");
      };
      if (blockOnCovers) {
        try {
          await coverFlight;
        } finally {
          endCoverPerf();
        }
      } else {
        void coverFlight
          .catch((err: unknown) => {
            reportServiceError("dashboard cover paths", err);
          })
          .finally(endCoverPerf);
      }
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
      await applyDashboardIndexPage(page, requestVersion, {
        prefetchSize: DASHBOARD_PREFETCH_SIZE,
        getRequestVersion: () => requestVersionRef.current,
        getPreviousIds: () => itemIdsRef.current,
        getPreviousStreamEnd: () => streamEndOffsetRef.current,
        itemsByIdHas: (id) => itemsByIdRef.current.has(id),
        cachedStampFor: (id) => bodyStampsRef.current.get(id),
        getItemIds: () => itemIdsRef.current,
        getItemsById: () => itemsByIdRef.current,
        getStreamEnd: () => streamEndOffsetRef.current,
        setTotalCount: (total) => {
          totalCountRef.current = total;
          setTotalCount(total);
        },
        setLoadedItemIds,
        setBodyStamps: (stamps) => {
          bodyStampsRef.current = stamps;
        },
        setStreamWindowEnd,
        clearCommittedEmpty: () => {
          applyListSnapshot({
            itemIds: itemIdsRef.current,
            itemsById: itemsByIdRef.current,
            bodyStamps: bodyStampsRef.current,
            streamEndOffset: streamEndOffsetRef.current,
            totalCount: totalCountRef.current,
            committedItems: [],
            committedTotalCount: 0,
            thumbnailPaths: new Map(),
            thumbnailStamps: new Map(),
          });
        },
        replaceWorkingBodiesKeeping: (idsToKeep) => {
          const kept = new Map<string, ItemFile>();
          for (const id of idsToKeep) {
            const existing = itemsByIdRef.current.get(id);
            if (existing) {
              kept.set(id, existing);
            }
          }
          itemsByIdRef.current = kept;
          setItemsById(kept);
        },
        intersectCommittedWithPage: (pageItemIds) => {
          const prevCommittedLen = committedItemsRef.current.length;
          const nextCommitted = intersectCommittedWithPageIdsHoldPaint(
            committedItemsRef.current,
            pageItemIds,
          );
          if (nextCommitted === null) {
            dashboardPerfNoteIntersect(dashboardPerfActiveRunId(), false);
            return;
          }
          dashboardPerfNoteIntersect(
            dashboardPerfActiveRunId(),
            prevCommittedLen > 0 && nextCommitted.length === 0,
          );
          const nextCommittedIds = nextCommitted.map((item) => item.id);
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
          applyListSnapshot({
            itemIds: itemIdsRef.current,
            itemsById: itemsByIdRef.current,
            bodyStamps: bodyStampsRef.current,
            streamEndOffset: streamEndOffsetRef.current,
            totalCount: totalCountRef.current,
            committedItems: nextCommitted,
            committedTotalCount: totalCountRef.current,
            thumbnailPaths: prunedPaths,
            thumbnailStamps: prunedStamps,
          });
        },
        streamSlice,
      });
    },
    [applyListSnapshot, setLoadedItemIds, setStreamWindowEnd, streamSlice],
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
    coverFlightRef.current?.batcher.cancel();
    coverFlightRef.current?.controller.abort();
    coverFlightRef.current = null;

    const controller = new AbortController();

    const tryCommitAfterIndexPage = async () => {
      if (requestVersionRef.current !== requestVersion) {
        return;
      }
      try {
        await commitWorkingToDisplay(requestVersion, { blockOnCovers: false });
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
          await commitWorkingToDisplay(requestVersion, { blockOnCovers: false });
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
      setDashboardQueryCache(
        queryKey,
        buildDashboardQueryCacheEntry({
          itemIds,
          itemsById,
          bodyStamps: bodyStampsRef.current,
          streamEndOffset,
          totalCount,
          thumbnailPaths: committedThumbnailPathsRef.current,
          thumbnailStamps: committedThumbnailStampsRef.current,
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

      applyListSnapshot(pruned);

      writeQueryCache(
        pruned.itemIds,
        pruned.itemsById,
        pruned.streamEndOffset,
        pruned.totalCount,
      );
    },
    [applyListSnapshot, writeQueryCache],
  );

  const refreshCoverForItem = useCallback((itemId: string) => {
    const item = itemsByIdRef.current.get(itemId);
    if (!item) {
      return;
    }
    const requestVersion = requestVersionRef.current;
    const cacheKeyForFlight = queryKeyRef.current;
    void resolveDashboardCoverPathsProgressive([item], {
      onResolved: (id, path) => {
        if (id !== itemId) {
          return;
        }
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        const stamp = `${item.thumbnail ?? ""}:${item.updated_at}`;
        const nextPaths = new Map(committedThumbnailPathsRef.current);
        const nextStamps = new Map(committedThumbnailStampsRef.current);
        nextPaths.set(itemId, path);
        nextStamps.set(itemId, stamp);
        const result = applyDashboardQueryCacheCoverFlightPatch({
          flightKey: cacheKeyForFlight,
          flightVersion: requestVersion,
          getLiveKey: () => queryKeyRef.current,
          getLiveVersion: () => requestVersionRef.current,
          thumbnailPaths: nextPaths,
          thumbnailStamps: nextStamps,
          rewriteFull: () => {
            setDashboardQueryCache(
              cacheKeyForFlight,
              buildDashboardQueryCacheEntry({
                itemIds: itemIdsRef.current,
                itemsById: itemsByIdRef.current,
                bodyStamps: bodyStampsRef.current,
                streamEndOffset: streamEndOffsetRef.current,
                totalCount: totalCountRef.current,
                thumbnailPaths: nextPaths,
                thumbnailStamps: nextStamps,
              }),
            );
          },
        });
        if (result === "skipped") {
          return;
        }
        setCommittedThumbnailPaths(nextPaths);
        setCommittedThumbnailStamps(nextStamps);
        committedThumbnailPathsRef.current = nextPaths;
        committedThumbnailStampsRef.current = nextStamps;
      },
    });
  }, []);

  const applyPresentationEvents = useCallback(
    (events: VaultPresentationChangedPayload[]) => {
      let softRefresh = false;
      for (const event of events) {
        const action = dashboardLiveActionForEvent(filterRef.current, event);
        if (action === "ignore") {
          continue;
        }
        if (action === "prune") {
          const pruneId = itemIdToPruneFromPresentationEvent(event);
          if (pruneId) {
            pruneItem(pruneId);
          }
          continue;
        }
        if (action === "coverPatch") {
          if (event.itemId) {
            refreshCoverForItem(event.itemId);
          }
          continue;
        }
        if (action === "softRefresh") {
          softRefresh = true;
        }
      }
      if (softRefresh) {
        // Same soft path as index-sync republish: no cache clear, no cold load.
        syncRepublishRef.current?.flush();
      }
    },
    [pruneItem, refreshCoverForItem],
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
    applyPresentationEvents,
  };
}
