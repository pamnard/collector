import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ItemFile } from "@collector/shared";
import { useAppSettings } from "../context/AppSettingsContext";
import {
  isDashboardPrefetchWindowReady,
  itemIdsEqual,
  orderDashboardItems,
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
import { reportServiceError } from "../services/runtime-error";
import { useVaultIndexSyncStatus } from "./useVaultIndexSyncStatus";

export { DASHBOARD_PREFETCH_SIZE, DASHBOARD_BATCH_SIZE } from "../services/collector-service";

interface UseDashboardItemsResult {
  items: ItemFile[];
  /** Resolved cover paths (null = no file cover). Decode is per-card. */
  thumbnailPaths: Map<string, string | null>;
  totalCount: number;
  isLoading: boolean;
  /** True while a filter/search/vault change holds the previous correct set. */
  isRefreshing: boolean;
  /** Bumps when a new set is committed after a refresh — drives crossfade. */
  transitionEpoch: number;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => void;
}

function readWarmStartSeed(filter: NavFilter, searchQuery: string) {
  const vaultId = getAppSettingsSync()?.active_vault_id;
  if (!vaultId) {
    return null;
  }
  return peekMatchingDashboardSnapshot(vaultId, filter, searchQuery);
}

function createInitialItemsByIdMap(
  filter: NavFilter,
  searchQuery: string,
): Map<string, ItemFile> {
  const warm = readWarmStartSeed(filter, searchQuery);
  if (!warm) {
    return new Map();
  }
  return new Map(warm.items.map((item) => [item.id, item]));
}

function initialCommittedItems(
  filter: NavFilter,
  searchQuery: string,
): ItemFile[] {
  const warm = readWarmStartSeed(filter, searchQuery);
  if (!warm) {
    return [];
  }
  return orderDashboardItems(
    warm.item_ids,
    new Map(warm.items.map((item) => [item.id, item])),
    warm.stream_end_offset,
  );
}

export function useDashboardItems(
  filter: NavFilter,
  searchQuery: string,
  vaultRevision: number,
): UseDashboardItemsResult {
  const { settings } = useAppSettings();

  const [itemIds, setItemIds] = useState<string[]>(
    () => readWarmStartSeed(filter, searchQuery)?.item_ids ?? [],
  );
  const [itemsById, setItemsById] = useState<Map<string, ItemFile>>(() => {
    const warm = readWarmStartSeed(filter, searchQuery);
    if (!warm) {
      return new Map();
    }
    return new Map(warm.items.map((item) => [item.id, item]));
  });
  const [streamEndOffset, setStreamEndOffset] = useState(
    () => readWarmStartSeed(filter, searchQuery)?.stream_end_offset ?? 0,
  );
  const [totalCount, setTotalCount] = useState(
    () => readWarmStartSeed(filter, searchQuery)?.total_count ?? 0,
  );
  const [isLoading, setIsLoading] = useState(
    () => readWarmStartSeed(filter, searchQuery) === null,
  );
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committedItems, setCommittedItems] = useState<ItemFile[]>(() =>
    initialCommittedItems(filter, searchQuery),
  );
  const [committedThumbnailPaths, setCommittedThumbnailPaths] = useState<
    Map<string, string | null>
  >(() => new Map());
  const [committedTotalCount, setCommittedTotalCount] = useState(
    () => readWarmStartSeed(filter, searchQuery)?.total_count ?? 0,
  );
  const [committedHasMore, setCommittedHasMore] = useState(() => {
    const warm = readWarmStartSeed(filter, searchQuery);
    if (!warm) {
      return false;
    }
    return warm.stream_end_offset < warm.total_count;
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [transitionEpoch, setTransitionEpoch] = useState(0);

  const indexSync = useVaultIndexSyncStatus();
  const requestVersionRef = useRef(0);
  const streamEndOffsetRef = useRef(
    readWarmStartSeed(filter, searchQuery)?.stream_end_offset ?? 0,
  );
  const itemIdsRef = useRef<string[]>(
    readWarmStartSeed(filter, searchQuery)?.item_ids ?? [],
  );
  const itemsByIdRef = useRef<Map<string, ItemFile>>(
    createInitialItemsByIdMap(filter, searchQuery),
  );
  const totalCountRef = useRef(
    readWarmStartSeed(filter, searchQuery)?.total_count ?? 0,
  );
  const isRefreshingRef = useRef(false);
  const hasCommittedOnceRef = useRef(
    readWarmStartSeed(filter, searchQuery) !== null,
  );
  const isFirstQueryRef = useRef(true);
  const streamAbortRef = useRef<AbortController | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    isRefreshingRef.current = isRefreshing;
  }, [isRefreshing]);

  const commitWorkingToDisplay = useCallback(
    async (bumpEpoch: boolean, requestVersion: number) => {
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
      // Paths only — do not block the grid on image decode (#176 per-card).
      const paths = await resolveDashboardCoverPaths(ordered);
      if (requestVersionRef.current !== requestVersion) {
        return;
      }

      setCommittedThumbnailPaths(paths);
      setCommittedItems(ordered);
      setCommittedTotalCount(totalCountRef.current);
      setCommittedHasMore(end < totalCountRef.current);
      hasCommittedOnceRef.current = true;
      if (isRefreshingRef.current) {
        setIsRefreshing(false);
        isRefreshingRef.current = false;
      }
      if (bumpEpoch) {
        setTransitionEpoch((epoch) => epoch + 1);
      }
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

      await streamDashboardItems(
        ids,
        offset,
        limit,
        (item) => {
          if (requestVersionRef.current !== requestVersion) {
            return;
          }
          setItemsById((current) => {
            const next = new Map(current);
            next.set(item.id, item);
            itemsByIdRef.current = next;
            return next;
          });
        },
        controller.signal,
      );
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
        const empty = new Map<string, ItemFile>();
        itemsByIdRef.current = empty;
        setItemsById(empty);
        setStreamWindowEnd(preservedEnd);
        await streamSlice(page.itemIds, 0, preservedEnd, requestVersion);
        return;
      }

      setStreamWindowEnd(preservedEnd);
      const needsStream = page.itemIds
        .slice(0, preservedEnd)
        .some((id) => !itemsByIdRef.current.has(id));
      if (needsStream) {
        await streamSlice(page.itemIds, 0, preservedEnd, requestVersion);
      }
    },
    [setLoadedItemIds, setStreamWindowEnd, streamSlice],
  );

  // Object folder/tag filters are new each render from navFilterFromSetting;
  // depend on filterKey only (#82). Do not re-add `filter` to deps (#114 / #78 regression).
  const filterKey = navFilterKey(filter);
  const vaultId = settings.active_vault_id ?? null;

  useLayoutEffect(() => {
    if (isFirstQueryRef.current) {
      isFirstQueryRef.current = false;
      return;
    }
    if (!hasCommittedOnceRef.current) {
      return;
    }
    isRefreshingRef.current = true;
    setIsRefreshing(true);
  }, [filterKey, searchQuery, vaultRevision]);

  useEffect(() => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;

    const warm =
      vaultId !== null
        ? peekMatchingDashboardSnapshot(vaultId, filter, searchQuery)
        : null;

    // Seed working state only. Display stays on the previous committed set
    // until prefetch + cover decode are ready (#176).
    if (!warm) {
      setIsLoading(true);
      setError(null);
      const empty = new Map<string, ItemFile>();
      itemsByIdRef.current = empty;
      setItemsById(empty);
      setLoadedItemIds([]);
      totalCountRef.current = 0;
      setTotalCount(0);
      setStreamWindowEnd(0);
    } else {
      setIsLoading(true);
      setError(null);
      setLoadedItemIds(warm.item_ids);
      const nextMap = new Map(warm.items.map((item) => [item.id, item]));
      itemsByIdRef.current = nextMap;
      setItemsById(nextMap);
      totalCountRef.current = warm.total_count;
      setTotalCount(warm.total_count);
      setStreamWindowEnd(warm.stream_end_offset);
    }

    streamAbortRef.current?.abort();

    const controller = new AbortController();

    const tryCommitAfterIndexPage = async () => {
      if (requestVersionRef.current !== requestVersion) {
        return;
      }
      const bumpEpoch = isRefreshingRef.current;
      try {
        await commitWorkingToDisplay(bumpEpoch, requestVersion);
      } catch (err: unknown) {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        reportServiceError("dashboard cover paths", err);
        setError(err instanceof Error ? err.message : String(err));
        if (isRefreshingRef.current) {
          setIsRefreshing(false);
          isRefreshingRef.current = false;
        }
      } finally {
        if (requestVersionRef.current === requestVersion) {
          setIsLoading(false);
          if (isRefreshingRef.current) {
            setIsRefreshing(false);
            isRefreshingRef.current = false;
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
              if (isRefreshingRef.current) {
                setIsRefreshing(false);
                isRefreshingRef.current = false;
              }
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
          if (isRefreshingRef.current) {
            setIsRefreshing(false);
            isRefreshingRef.current = false;
          }
        },
      },
      controller.signal,
    );

    return () => {
      controller.abort();
      streamAbortRef.current?.abort();
    };
  }, [
    applyIndexPage,
    commitWorkingToDisplay,
    filterKey,
    searchQuery,
    setLoadedItemIds,
    setStreamWindowEnd,
    vaultId,
    vaultRevision,
  ]);

  useEffect(() => {
    if (isRefreshing || isLoading) {
      return;
    }
    // load-more / in-place stream growth — no epoch bump, no cover gate
    setCommittedItems(workingItems);
    setCommittedTotalCount(totalCount);
    setCommittedHasMore(streamEndOffset < totalCount);
  }, [isRefreshing, isLoading, workingItems, totalCount, streamEndOffset]);

  useEffect(() => {
    if (
      !vaultId ||
      isLoading ||
      isRefreshing ||
      !itemIds.length ||
      !workingItems.length
    ) {
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
    }, 400);

    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }
    };
  }, [
    filterKey,
    isLoading,
    isRefreshing,
    itemIds,
    workingItems,
    searchQuery,
    streamEndOffset,
    totalCount,
    vaultId,
  ]);

  const loadMore = useCallback(() => {
    if (isLoading || isLoadingMore || isRefreshing) {
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
    isRefreshing,
    itemIds,
    searchQuery,
    setLoadedItemIds,
    setStreamWindowEnd,
    streamEndOffset,
    streamSlice,
    totalCount,
  ]);

  const showInitialLoading =
    (isLoading || isRefreshing) && committedItems.length === 0;

  return {
    items: committedItems,
    thumbnailPaths: committedThumbnailPaths,
    totalCount: committedTotalCount,
    isLoading: showInitialLoading || isIndexingEmptyGrid,
    isRefreshing: isRefreshing && committedItems.length > 0,
    transitionEpoch,
    isLoadingMore,
    hasMore: committedHasMore,
    error,
    loadMore,
  };
}
