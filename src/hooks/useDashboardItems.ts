import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DashboardSnapshot, ItemFile } from "@collector/shared";
import { useAppSettings } from "../context/AppSettingsContext";
import {
  isDashboardPrefetchWindowReady,
  itemIdsEqual,
  mergeStreamedItemsById,
  orderDashboardItems,
  shouldApplyDashboardStreamBatch,
} from "../lib/dashboard-display";
import { resolveDashboardCoverPaths } from "../lib/preload-dashboard-covers";
import { navFilterKey, type NavFilter } from "../types/ui";
import {
  DASHBOARD_PREFETCH_SIZE,
  fetchDashboardIndexPage,
  streamDashboardItems,
  subscribeDashboardLoad,
} from "../services/collector-service";
import { getAppSettingsSync } from "../services/app-settings-service";
import {
  buildDashboardSnapshot,
  peekMatchingDashboardSnapshot,
  persistDashboardSnapshot,
} from "../services/dashboard-snapshot-service";
import {
  dashboardQueryCacheKey,
  getDashboardQueryCache,
  setDashboardQueryCache,
  type DashboardQueryCacheEntry,
} from "../services/dashboard-query-cache";
import { reportServiceError } from "../services/runtime-error";
import { useVaultIndexSyncStatus } from "./useVaultIndexSyncStatus";

export { DASHBOARD_PREFETCH_SIZE } from "../services/collector-service";

interface UseDashboardItemsResult {
  items: ItemFile[];
  /** Resolved cover paths (null = no file cover). Decode is per-card. */
  thumbnailPaths: Map<string, string | null>;
  totalCount: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => void;
}

function snapshotToCacheEntry(
  snap: DashboardSnapshot,
): DashboardQueryCacheEntry {
  return {
    itemIds: [...snap.item_ids],
    itemsById: new Map(snap.items.map((item) => [item.id, item])),
    streamEndOffset: snap.stream_end_offset,
    totalCount: snap.total_count,
    thumbnailPaths: new Map(),
    updatedAt: Date.now(),
  };
}

function readInitialCacheEntry(
  filter: NavFilter,
  searchQuery: string,
): DashboardQueryCacheEntry | null {
  const key = dashboardQueryCacheKey(navFilterKey(filter), searchQuery);
  const cached = getDashboardQueryCache(key);
  if (cached) {
    return cached;
  }

  const vaultId = getAppSettingsSync()?.active_vault_id;
  if (!vaultId) {
    return null;
  }
  const warm = peekMatchingDashboardSnapshot(vaultId, filter, searchQuery);
  if (!warm) {
    return null;
  }
  const entry = snapshotToCacheEntry(warm);
  setDashboardQueryCache(key, entry);
  return getDashboardQueryCache(key);
}

function orderedIds(items: ItemFile[]): string[] {
  return items.map((item) => item.id);
}

function thumbnailPathsEqual(
  left: Map<string, string | null>,
  right: Map<string, string | null>,
  ids: string[],
): boolean {
  for (const id of ids) {
    if ((left.get(id) ?? null) !== (right.get(id) ?? null)) {
      return false;
    }
  }
  return true;
}

function itemsBodiesEqual(left: ItemFile[], right: ItemFile[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i++) {
    const a = left[i]!;
    const b = right[i]!;
    if (
      a.id !== b.id ||
      a.updated_at !== b.updated_at ||
      a.title !== b.title ||
      a.thumbnail !== b.thumbnail
    ) {
      return false;
    }
  }
  return true;
}

export function useDashboardItems(
  filter: NavFilter,
  searchQuery: string,
  vaultRevision: number,
): UseDashboardItemsResult {
  const { settings } = useAppSettings();

  const [initial] = useState(() => readInitialCacheEntry(filter, searchQuery));
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
  const totalCountRef = useRef(initial?.totalCount ?? 0);
  const committedItemsRef = useRef(committedItems);
  const committedThumbnailPathsRef = useRef(committedThumbnailPaths);
  const committedTotalCountRef = useRef(committedTotalCount);
  const queryKeyRef = useRef(
    dashboardQueryCacheKey(navFilterKey(filter), searchQuery),
  );
  const streamAbortRef = useRef<AbortController | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryBusyRef = useRef(false);

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
    committedTotalCountRef.current = committedTotalCount;
  }, [committedTotalCount]);

  const applyCacheEntryToState = useCallback((entry: DashboardQueryCacheEntry) => {
    itemIdsRef.current = entry.itemIds;
    itemsByIdRef.current = entry.itemsById;
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
    setCommittedItems(ordered);
    setCommittedThumbnailPaths(new Map(entry.thumbnailPaths));
    setCommittedTotalCount(entry.totalCount);
    setCommittedHasMore(entry.streamEndOffset < entry.totalCount);
    committedItemsRef.current = ordered;
    committedThumbnailPathsRef.current = new Map(entry.thumbnailPaths);
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
      // Aborted/incomplete stream must not blank a held previous paint.
      if (ordered.length === 0 && prevItems.length > 0 && nextTotal > 0) {
        return;
      }

      const paths = await resolveDashboardCoverPaths(ordered);
      if (requestVersionRef.current !== requestVersion) {
        return;
      }

      const prevPaths = committedThumbnailPathsRef.current;
      const prevTotal = committedTotalCountRef.current;
      const idsMatch = itemIdsEqual(orderedIds(prevItems), orderedIds(ordered));
      const unchanged =
        idsMatch &&
        prevTotal === nextTotal &&
        itemsBodiesEqual(prevItems, ordered) &&
        thumbnailPathsEqual(prevPaths, paths, orderedIds(ordered));

      if (!unchanged) {
        const mergedPaths = new Map(prevPaths);
        for (const id of orderedIds(ordered)) {
          if (paths.has(id)) {
            mergedPaths.set(id, paths.get(id) ?? null);
          }
        }
        for (const id of [...mergedPaths.keys()]) {
          if (!ordered.some((item) => item.id === id)) {
            mergedPaths.delete(id);
          }
        }
        setCommittedThumbnailPaths(mergedPaths);
        setCommittedItems(ordered);
        setCommittedTotalCount(nextTotal);
        setCommittedHasMore(end < nextTotal);
        committedItemsRef.current = ordered;
        committedThumbnailPathsRef.current = mergedPaths;
        committedTotalCountRef.current = nextTotal;
      }

      setDashboardQueryCache(queryKeyRef.current, {
        itemIds: [...ids],
        itemsById: new Map(byId),
        streamEndOffset: end,
        totalCount: nextTotal,
        thumbnailPaths: new Map(committedThumbnailPathsRef.current),
        updatedAt: Date.now(),
      });
    },
    [],
  );

  const streamSlice = useCallback(
    async (
      ids: string[],
      offset: number,
      limit: number,
      requestVersion: number,
    ): Promise<void> => {
      if (!ids.length || offset >= ids.length || limit <= 0) {
        return;
      }

      streamAbortRef.current?.abort();
      const controller = new AbortController();
      streamAbortRef.current = controller;

      const pending = new Map<string, ItemFile>();
      await streamDashboardItems(
        ids,
        offset,
        limit,
        (item) => {
          if (requestVersionRef.current !== requestVersion) {
            return;
          }
          pending.set(item.id, item);
        },
        controller.signal,
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
      page: { itemIds: string[]; totalCount: number; offset: number },
      requestVersion: number,
    ): Promise<void> => {
      totalCountRef.current = page.totalCount;
      setTotalCount(page.totalCount);

      if (page.offset !== 0) {
        return;
      }

      if (!page.itemIds.length) {
        setLoadedItemIds([]);
        setStreamWindowEnd(0);
        return;
      }

      const preservedEnd =
        streamEndOffsetRef.current > 0
          ? Math.min(streamEndOffsetRef.current, page.itemIds.length)
          : Math.min(DASHBOARD_PREFETCH_SIZE, page.itemIds.length);

      const previousIds = itemIdsRef.current;
      const sameIds = itemIdsEqual(previousIds, page.itemIds);

      if (!sameIds) {
        setLoadedItemIds(page.itemIds);
        const kept = new Map<string, ItemFile>();
        for (const id of page.itemIds) {
          const existing = itemsByIdRef.current.get(id);
          if (existing) {
            kept.set(id, existing);
          }
        }
        itemsByIdRef.current = kept;
        setItemsById(kept);
        setStreamWindowEnd(preservedEnd);
        await streamSlice(page.itemIds, 0, preservedEnd, requestVersion);
        if (
          !isDashboardPrefetchWindowReady(
            itemIdsRef.current,
            itemsByIdRef.current,
            streamEndOffsetRef.current,
          )
        ) {
          // First stream often races with effect abort on query switch — retry once.
          await streamSlice(page.itemIds, 0, preservedEnd, requestVersion);
        }
        return;
      }

      setStreamWindowEnd(preservedEnd);
      const needsStream = page.itemIds
        .slice(0, preservedEnd)
        .some((id) => !itemsByIdRef.current.has(id));
      if (needsStream) {
        await streamSlice(page.itemIds, 0, preservedEnd, requestVersion);
        if (
          !isDashboardPrefetchWindowReady(
            itemIdsRef.current,
            itemsByIdRef.current,
            streamEndOffsetRef.current,
          )
        ) {
          await streamSlice(page.itemIds, 0, preservedEnd, requestVersion);
        }
      }
    },
    [setLoadedItemIds, setStreamWindowEnd, streamSlice],
  );

  // Object folder/tag filters are new each render from navFilterFromSetting;
  // depend on filterKey only (#82). Do not re-add `filter` to deps (#114 / #78 regression).
  const filterKey = navFilterKey(filter);
  const vaultId = settings.active_vault_id ?? null;
  const queryKey = dashboardQueryCacheKey(filterKey, searchQuery);

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
      const warm = peekMatchingDashboardSnapshot(vaultId, filter, searchQuery);
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
    streamEndOffsetRef.current = 0;
    totalCountRef.current = 0;
    setItemIds([]);
    setItemsById(new Map());
    setStreamEndOffset(0);
    setTotalCount(0);
    if (prevCommitted === 0) {
      setCommittedItems([]);
      setCommittedThumbnailPaths(new Map());
      setCommittedTotalCount(0);
      setCommittedHasMore(false);
      committedItemsRef.current = [];
      committedThumbnailPathsRef.current = new Map();
      committedTotalCountRef.current = 0;
    }
    setIsLoading(true);
  }, [applyCacheEntryToState, filter, queryKey, searchQuery, vaultId]);

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
      setItemsById(cached.itemsById);
      totalCountRef.current = cached.totalCount;
      setTotalCount(cached.totalCount);
      setStreamWindowEnd(cached.streamEndOffset);
      setIsLoading(false);
    } else if (committedItemsRef.current.length === 0) {
      setIsLoading(true);
      const empty = new Map<string, ItemFile>();
      itemsByIdRef.current = empty;
      setItemsById(empty);
      setLoadedItemIds([]);
      totalCountRef.current = 0;
      setTotalCount(0);
      setStreamWindowEnd(0);
    }

    streamAbortRef.current?.abort();

    const controller = new AbortController();

    const tryCommitAfterIndexPage = async () => {
      if (requestVersionRef.current !== requestVersion) {
        return;
      }
      try {
        const ready = isDashboardPrefetchWindowReady(
          itemIdsRef.current,
          itemsByIdRef.current,
          streamEndOffsetRef.current,
        );
        if (!ready && totalCountRef.current > 0) {
          return;
        }
        await commitWorkingToDisplay(requestVersion);
      } catch (err: unknown) {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        reportServiceError("dashboard cover paths", err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (requestVersionRef.current === requestVersion) {
          const ready = isDashboardPrefetchWindowReady(
            itemIdsRef.current,
            itemsByIdRef.current,
            streamEndOffsetRef.current,
          );
          if (ready || totalCountRef.current === 0) {
            setIsLoading(false);
            queryBusyRef.current = false;
          }
        }
      }
    };

    subscribeDashboardLoad(
      filter,
      searchQuery,
      {
        onIndexPage: (page) => {
          if (requestVersionRef.current !== requestVersion) {
            return;
          }
          void applyIndexPage(page, requestVersion)
            .then(async () => {
              if (requestVersionRef.current !== requestVersion) {
                return;
              }
              if (page.offset === 0) {
                await tryCommitAfterIndexPage();
              }
            })
            .catch((err: unknown) => {
              if (requestVersionRef.current !== requestVersion) {
                return;
              }
              reportServiceError("dashboard index apply", err);
              setError(err instanceof Error ? err.message : String(err));
              setIsLoading(false);
              queryBusyRef.current = false;
            });
        },
        getLoadedIdCount: () => itemIdsRef.current.length,
        onError: (scope, err) => {
          if (requestVersionRef.current !== requestVersion) {
            return;
          }
          reportServiceError(scope, err);
          setError(err instanceof Error ? err.message : String(err));
          setIsLoading(false);
          queryBusyRef.current = false;
        },
      },
      controller.signal,
    );

    return () => {
      controller.abort();
      streamAbortRef.current?.abort();
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
    setCommittedItems(workingItems);
    setCommittedTotalCount(totalCount);
    setCommittedHasMore(streamEndOffset < totalCount);
    committedItemsRef.current = workingItems;
    committedTotalCountRef.current = totalCount;
  }, [isLoading, workingItems, totalCount, streamEndOffset]);

  useEffect(() => {
    if (!vaultId || isLoading || !itemIds.length || !workingItems.length) {
      return;
    }

    persistTimerRef.current = setTimeout(() => {
      void persistDashboardSnapshot(
        buildDashboardSnapshot({
          vaultId,
          filter,
          search: searchQuery,
          itemIds,
          items: workingItems,
          totalCount,
          streamEndOffset,
        }),
      );
      setDashboardQueryCache(queryKey, {
        itemIds: [...itemIds],
        itemsById: new Map(itemsById),
        streamEndOffset,
        totalCount,
        thumbnailPaths: new Map(committedThumbnailPathsRef.current),
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
    streamEndOffset,
    totalCount,
    vaultId,
  ]);

  const loadMore = useCallback(() => {
    if (isLoading || isLoadingMore) {
      return;
    }

    const requestVersion = requestVersionRef.current;
    const loadedCount = itemIds.length;
    const needsMoreIds = streamEndOffset + DASHBOARD_PREFETCH_SIZE > loadedCount;
    const hasUnloadedIds = loadedCount < totalCount;

    if (streamEndOffset >= loadedCount && !hasUnloadedIds) {
      return;
    }

    setIsLoadingMore(true);

    const streamNextWindow = (ids: string[]) => {
      const offset = streamEndOffsetRef.current;
      const limit = Math.min(DASHBOARD_PREFETCH_SIZE, ids.length - offset);
      const nextEnd = offset + limit;
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

    if (needsMoreIds && hasUnloadedIds) {
      void fetchDashboardIndexPage(filter, searchQuery, {
        offset: loadedCount,
        limit: DASHBOARD_PREFETCH_SIZE,
      })
        .then((page) => {
          if (requestVersionRef.current !== requestVersion) {
            return;
          }
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
    filterKey,
    isLoading,
    isLoadingMore,
    itemIds,
    searchQuery,
    setLoadedItemIds,
    setStreamWindowEnd,
    streamEndOffset,
    streamSlice,
    totalCount,
  ]);

  const showSkeleton =
    (isLoading && committedItems.length === 0) || isIndexingEmptyGrid;

  return {
    items: committedItems,
    thumbnailPaths: committedThumbnailPaths,
    totalCount: committedTotalCount,
    isLoading: showSkeleton,
    isLoadingMore,
    hasMore: committedHasMore,
    error,
    loadMore,
  };
}
