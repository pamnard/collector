import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { flushSync } from "react-dom";
import type { ItemFile } from "@collector/shared";
import type { DashboardItemSort } from "@collector/api";
import {
  applyDashboardListSnapshot,
  bodyStampsForOrderedIds,
  itemsBodiesEqual,
  orderedIds,
  pruneItemIdFromDashboardLists,
  shouldSkipCommitPaint,
  shouldSkipEmptyCommit,
  type DashboardListSnapshot,
} from "../../lib/dashboard-commit";
import {
  coverMapsForPersistence,
  coverMapsNeedsResolve,
} from "../../lib/cover-maps";
import type { CoverController } from "../../lib/cover-controller";
import { revealHeldListPaint } from "../../lib/dashboard-cold-reveal";
import {
  isDashboardPrefetchWindowReady,
  itemIdsEqual,
  orderDashboardItems,
} from "../../lib/dashboard-display";
import {
  buildDashboardQueryCacheEntry,
  stateFromDashboardCacheEntry,
} from "../../lib/dashboard-query-load";
import { navFilterKey, type NavFilter } from "../../types/ui";
import {
  dashboardQueryCacheKey,
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

export function useDashboardListState(options: {
  filter: NavFilter;
  searchQuery: string;
  sort: DashboardItemSort;
  vaultId: string | null | undefined;
  startCoverPathFlightRef: MutableRefObject<StartCoverPathFlight>;
  covers: CoverController;
  initialCache: DashboardQueryCacheEntry | null;
}): DashboardListState {
  const {
    filter,
    searchQuery,
    sort,
    startCoverPathFlightRef,
    covers,
    initialCache: initial,
  } = options;

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

  committedItemsRef.current = committedItems;
  committedTotalCountRef.current = committedTotalCount;

  const writeQueryCache = useCallback(
    (
      ids: string[],
      byId: Map<string, ItemFile>,
      end: number,
      nextTotal: number,
    ) => {
      const persisted = coverMapsForPersistence(covers.getMaps());
      setDashboardQueryCache(
        queryKeyRef.current,
        buildDashboardQueryCacheEntry({
          itemIds: ids,
          itemsById: byId,
          bodyStamps: bodyStampsRef.current,
          streamEndOffset: end,
          totalCount: nextTotal,
          covers: persisted,
        }),
      );
    },
    [covers],
  );

  /** Single path for working + committed + refs (#655). */
  const applyListSnapshot = useCallback(
    (snapshot: DashboardListSnapshot) => {
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
        setCoverMaps: (maps) => {
          covers.replaceMaps(maps);
        },
      });
    },
    [covers],
  );

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
        covers: next.covers,
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
          // Seed flight maps; defer React list paint until covers are ready (#855).
          covers.intersect(nextOrderedIds, {
            deferPublish: blockOnCovers,
            requestVersion: blockOnCovers ? requestVersion : undefined,
          });
          committedBodyStampsRef.current = bodyStampsForOrderedIds(
            bodyStampsRef.current,
            nextOrderedIds,
          );

          if (blockOnCovers) {
            heldListPaint = true;
          } else {
            const perfRunId = dashboardPerfActiveRunId();
            dashboardPerfBeginPhase(perfRunId, "commitList");
            setCommittedItems(ordered);
            setCommittedTotalCount(nextTotal);
            setCommittedHasMore(end < nextTotal);
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

      const coverMaps = covers.getMaps();
      const coversNeedResolve = ordered.some((item) =>
        coverMapsNeedsResolve(coverMaps, item),
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
        const perfRunId = dashboardPerfActiveRunId();
        dashboardPerfBeginPhase(perfRunId, "commitList");
        const revealed = revealHeldListPaint({
          requestVersion,
          getCurrentVersion: () => requestVersionRef.current,
          covers,
          flushSync,
          applyCommitted: () => {
            setCommittedItems(ordered);
            setCommittedTotalCount(nextTotal);
            setCommittedHasMore(end < nextTotal);
          },
        });
        if (revealed === "cancelled-stale") {
          dashboardPerfEndPhase(perfRunId, "commitList");
          return;
        }
        committedItemsRef.current = ordered;
        committedTotalCountRef.current = nextTotal;
        dashboardPerfEndPhase(perfRunId, "commitList");
        dashboardPerfNoteItemCount(perfRunId, ordered.length);
        writeQueryCache(ids, byId, end, nextTotal);
      }
    },
    [covers, startCoverPathFlightRef, writeQueryCache],
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
    setCommittedTotalCount(0);
    setCommittedHasMore(false);
    committedItemsRef.current = [];
    committedTotalCountRef.current = 0;
    committedBodyStampsRef.current = new Map();
    covers.clear();
  }, [covers]);

  const pruneItem = useCallback(
    (itemId: string) => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }

      const maps = covers.getMaps();
      const pruned = pruneItemIdFromDashboardLists(itemId, {
        itemIds: itemIdsRef.current,
        itemsById: itemsByIdRef.current,
        bodyStamps: bodyStampsRef.current,
        covers: maps,
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
    [applyListSnapshot, covers, writeQueryCache],
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
    committedTotalCountRef,
    queryKeyRef,
    streamAbortRef,
    persistTimerRef,
    queryBusyRef,
    filterRef,
    searchQueryRef,
    sortRef,
    covers,
    setItemIds,
    setItemsById,
    setStreamEndOffset,
    setTotalCount,
    setIsLoading,
    setIsLoadingMore,
    setError,
    setCommittedItems,
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
