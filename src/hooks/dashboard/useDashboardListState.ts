import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { ItemFile } from "@collector/shared";
import type { DashboardItemSort, ItemThumbnailPixelSize } from "@collector/api";
import {
  applyDashboardListSnapshot,
  bodyStampsForOrderedIds,
  coverNeedsResolve,
  itemsBodiesEqual,
  mergeCommittedThumbnailPaths,
  mergeCommittedThumbnailSizes,
  mergeCommittedThumbnailStamps,
  orderedIds,
  pruneItemIdFromDashboardLists,
  shouldSkipCommitPaint,
  shouldSkipEmptyCommit,
  snapshotToCacheEntry,
  type DashboardListSnapshot,
} from "../../lib/dashboard-commit";
import { shouldDeferListPaintUntilCovers } from "../../lib/dashboard-cold-cover-reveal";
import {
  isDashboardPrefetchWindowReady,
  itemIdsEqual,
  orderDashboardItems,
} from "../../lib/dashboard-display";
import {
  buildDashboardQueryCacheEntry,
  readInitialDashboardCacheEntry,
  stateFromDashboardCacheEntry,
} from "../../lib/dashboard-query-load";
import { navFilterKey, type NavFilter } from "../../types/ui";
import { getUiSession } from "../../services/collector-client";
import {
  dashboardQueryCacheKey,
  getDashboardQueryCache,
  removeItemIdFromDashboardQueryCache,
  setDashboardQueryCache,
  type DashboardQueryCacheEntry,
} from "../../services/dashboard-query-cache";
import {
  dashboardPerfActiveRunId,
  dashboardPerfBeginPhase,
  dashboardPerfEndPhase,
  dashboardPerfNoteItemCount,
} from "../../lib/dashboard-perf";
import { reportServiceError } from "../../services/runtime-error";
import type {
  DashboardListState,
  StartCoverPathFlight,
} from "./dashboard-list-state-types";

export type {
  DashboardListState,
  StartCoverPathFlight,
} from "./dashboard-list-state-types";

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

export function useDashboardListState(options: {
  filter: NavFilter;
  searchQuery: string;
  sort: DashboardItemSort;
  vaultId: string | null | undefined;
  startCoverPathFlightRef: MutableRefObject<StartCoverPathFlight>;
}): DashboardListState {
  const { filter, searchQuery, sort, vaultId, startCoverPathFlightRef } =
    options;

  const [initial] = useState(() =>
    readInitialCacheEntry(filter, searchQuery, sort, vaultId),
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
  >(() => (initial ? new Map(initial.thumbnailPaths) : new Map()));
  const [committedThumbnailStamps, setCommittedThumbnailStamps] = useState<
    Map<string, string>
  >(() => (initial ? new Map(initial.thumbnailStamps) : new Map()));
  const [committedThumbnailSizes, setCommittedThumbnailSizes] = useState<
    Map<string, ItemThumbnailPixelSize | null>
  >(() => (initial ? new Map(initial.thumbnailSizes) : new Map()));
  const [committedTotalCount, setCommittedTotalCount] = useState(
    () => initial?.totalCount ?? 0,
  );
  const [committedHasMore, setCommittedHasMore] = useState(() => {
    if (!initial) {
      return false;
    }
    return initial.streamEndOffset < initial.totalCount;
  });

  const requestVersionRef = useRef(0);
  const streamEndOffsetRef = useRef(initial?.streamEndOffset ?? 0);
  const itemIdsRef = useRef<string[]>(initial?.itemIds ?? []);
  const itemsByIdRef = useRef<Map<string, ItemFile>>(
    initial?.itemsById ?? new Map(),
  );
  const bodyStampsRef = useRef<Map<string, string>>(
    initial?.bodyStamps ?? new Map(),
  );
  /** Body stamps for the last committed paint window (#664). */
  const committedBodyStampsRef = useRef<Map<string, string>>(
    initial
      ? bodyStampsForOrderedIds(
          initial.bodyStamps,
          initial.itemIds.slice(0, initial.streamEndOffset),
        )
      : new Map(),
  );
  const totalCountRef = useRef(initial?.totalCount ?? 0);
  const committedItemsRef = useRef(committedItems);
  const committedThumbnailPathsRef = useRef(committedThumbnailPaths);
  const committedThumbnailStampsRef = useRef(committedThumbnailStamps);
  const committedThumbnailSizesRef = useRef(committedThumbnailSizes);
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
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryBusyRef = useRef(false);
  const filterRef = useRef(filter);
  const searchQueryRef = useRef(searchQuery);
  const sortRef = useRef(sort);
  filterRef.current = filter;
  searchQueryRef.current = searchQuery;
  sortRef.current = sort;

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
    committedThumbnailSizesRef.current = committedThumbnailSizes;
  }, [committedThumbnailSizes]);

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
          thumbnailSizes: committedThumbnailSizesRef.current,
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
        committedBodyStampsRef.current = bodyStampsForOrderedIds(
          bodyStampsRef.current,
          orderedIds(items),
        );
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
      setCommittedThumbnailSizes: (sizes) => {
        committedThumbnailSizesRef.current = sizes;
        setCommittedThumbnailSizes(sizes);
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
        thumbnailSizes: next.thumbnailSizes,
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
      const deferListPaint = shouldDeferListPaintUntilCovers(blockOnCovers);

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
      const skipPaint = shouldSkipCommitPaint({
        prevOrderedIds: orderedIds(prevItems),
        nextOrderedIds,
        prevTotalCount: prevTotal,
        nextTotalCount: nextTotal,
        prevBodyStamps: committedBodyStampsRef.current,
        nextBodyStamps: bodyStampsRef.current,
      });

      let heldListPaint = false;

      if (!skipPaint) {
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
          const prunedSizes = mergeCommittedThumbnailSizes(
            committedThumbnailSizesRef.current,
            new Map(),
            nextOrderedIds,
          );

          // Seed flight refs; defer React list paint until covers are ready (#855).
          committedThumbnailPathsRef.current = prunedPaths;
          committedThumbnailStampsRef.current = prunedStamps;
          committedThumbnailSizesRef.current = prunedSizes;
          committedBodyStampsRef.current = bodyStampsForOrderedIds(
            bodyStampsRef.current,
            nextOrderedIds,
          );

          if (deferListPaint) {
            heldListPaint = true;
          } else {
            const perfRunId = dashboardPerfActiveRunId();
            dashboardPerfBeginPhase(perfRunId, "commitList");
            setCommittedItems(ordered);
            setCommittedTotalCount(nextTotal);
            setCommittedHasMore(end < nextTotal);
            setCommittedThumbnailPaths(prunedPaths);
            setCommittedThumbnailStamps(prunedStamps);
            setCommittedThumbnailSizes(prunedSizes);
            committedItemsRef.current = ordered;
            committedTotalCountRef.current = nextTotal;
            dashboardPerfEndPhase(perfRunId, "commitList");
            dashboardPerfNoteItemCount(perfRunId, ordered.length);
            writeQueryCache(ids, byId, end, nextTotal);
          }
        } else {
          committedBodyStampsRef.current = bodyStampsForOrderedIds(
            bodyStampsRef.current,
            nextOrderedIds,
          );
          writeQueryCache(ids, byId, end, nextTotal);
        }
      }

      const coversNeedResolve = ordered.some((item) =>
        coverNeedsResolve(
          item,
          committedThumbnailPathsRef.current,
          committedThumbnailStampsRef.current,
          committedThumbnailSizesRef.current,
        ),
      );
      if (skipPaint && !coversNeedResolve && !heldListPaint) {
        return;
      }

      if (coversNeedResolve || blockOnCovers) {
        try {
          await startCoverPathFlightRef.current(requestVersion, ordered, {
            blockOnCovers,
            deferUiCommit: heldListPaint,
          });
        } catch (err: unknown) {
          if (!heldListPaint) {
            throw err;
          }
          reportServiceError(
            "dashboard cover paths before held list reveal",
            err,
          );
        }
      }

      if (heldListPaint) {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        const perfRunId = dashboardPerfActiveRunId();
        dashboardPerfBeginPhase(perfRunId, "commitList");
        setCommittedItems(ordered);
        setCommittedTotalCount(nextTotal);
        setCommittedHasMore(end < nextTotal);
        setCommittedThumbnailPaths(committedThumbnailPathsRef.current);
        setCommittedThumbnailStamps(committedThumbnailStampsRef.current);
        setCommittedThumbnailSizes(committedThumbnailSizesRef.current);
        committedItemsRef.current = ordered;
        committedTotalCountRef.current = nextTotal;
        dashboardPerfEndPhase(perfRunId, "commitList");
        dashboardPerfNoteItemCount(perfRunId, ordered.length);
        writeQueryCache(ids, byId, end, nextTotal);
      }
    },
    [startCoverPathFlightRef, writeQueryCache],
  );

  const setStreamWindowEnd = useCallback((end: number) => {
    streamEndOffsetRef.current = end;
    setStreamEndOffset(end);
  }, []);

  const setLoadedItemIds = useCallback((nextIds: string[]) => {
    itemIdsRef.current = nextIds;
    setItemIds(nextIds);
  }, []);

  const clearWorkingWindow = useCallback(() => {
    itemIdsRef.current = [];
    itemsByIdRef.current = new Map();
    bodyStampsRef.current = new Map();
    streamEndOffsetRef.current = 0;
    totalCountRef.current = 0;
    setItemIds([]);
    setItemsById(new Map());
    setStreamEndOffset(0);
    setTotalCount(0);
  }, []);

  const clearCommittedPaint = useCallback(() => {
    setCommittedItems([]);
    setCommittedThumbnailPaths(new Map());
    setCommittedThumbnailStamps(new Map());
    setCommittedThumbnailSizes(new Map());
    setCommittedTotalCount(0);
    setCommittedHasMore(false);
    committedItemsRef.current = [];
    committedThumbnailPathsRef.current = new Map();
    committedThumbnailStampsRef.current = new Map();
    committedThumbnailSizesRef.current = new Map();
    committedTotalCountRef.current = 0;
    committedBodyStampsRef.current = new Map();
  }, []);

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
        thumbnailSizes: committedThumbnailSizesRef.current,
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

  return {
    itemIds,
    itemsById,
    streamEndOffset,
    totalCount,
    isLoading,
    isLoadingMore,
    error,
    committedItems,
    committedThumbnailPaths,
    committedThumbnailStamps,
    committedThumbnailSizes,
    committedTotalCount,
    committedHasMore,
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
    setItemIds,
    setItemsById,
    setStreamEndOffset,
    setTotalCount,
    setIsLoading,
    setIsLoadingMore,
    setError,
    setCommittedItems,
    setCommittedThumbnailPaths,
    setCommittedThumbnailStamps,
    setCommittedThumbnailSizes,
    setCommittedTotalCount,
    setCommittedHasMore,
    writeQueryCache,
    applyListSnapshot,
    applyCacheEntryToState,
    commitWorkingToDisplay,
    setStreamWindowEnd,
    setLoadedItemIds,
    pruneItem,
    clearWorkingWindow,
    clearCommittedPaint,
  };
}
