import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ItemFile } from "@collector/shared";
import { useAppSettings } from "../context/AppSettingsContext";
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
  totalCount: number;
  isLoading: boolean;
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

function itemIdsEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length && left.every((id, index) => id === right[index])
  );
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
  const streamAbortRef = useRef<AbortController | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isIndexingEmptyGrid =
    (indexSync.status === "running" || indexSync.status === "rebuilding") &&
    totalCount === 0 &&
    itemIds.length === 0;

  const items = useMemo(() => {
    const ordered: ItemFile[] = [];
    for (const id of itemIds.slice(0, streamEndOffset)) {
      const item = itemsById.get(id);
      if (item) {
        ordered.push(item);
      }
    }
    return ordered;
  }, [itemIds, itemsById, streamEndOffset]);

  useEffect(() => {
    itemsByIdRef.current = itemsById;
  }, [itemsById]);

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
    (
      page: { itemIds: string[]; totalCount: number; offset: number },
      requestVersion: number,
    ) => {
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
        setItemsById(new Map());
        setStreamWindowEnd(preservedEnd);
        void streamSlice(page.itemIds, 0, preservedEnd, requestVersion);
        return;
      }

      setStreamWindowEnd(preservedEnd);
      const needsStream = page.itemIds
        .slice(0, preservedEnd)
        .some((id) => !itemsByIdRef.current.has(id));
      if (needsStream) {
        void streamSlice(page.itemIds, 0, preservedEnd, requestVersion);
      }
    },
    [setLoadedItemIds, setStreamWindowEnd, streamSlice],
  );

  // Object folder/tag filters are new each render from navFilterFromSetting;
  // depend on filterKey only (#82). Do not re-add `filter` to deps (#114 / #78 regression).
  const filterKey = navFilterKey(filter);
  const vaultId = settings.active_vault_id ?? null;

  useEffect(() => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;

    const warm =
      vaultId !== null
        ? peekMatchingDashboardSnapshot(vaultId, filter, searchQuery)
        : null;

    if (!warm) {
      setIsLoading(true);
      setError(null);
      setItemsById(new Map());
      setLoadedItemIds([]);
      setTotalCount(0);
      setStreamWindowEnd(0);
    } else {
      setIsLoading(false);
      setError(null);
      setLoadedItemIds(warm.item_ids);
      setItemsById(new Map(warm.items.map((item) => [item.id, item])));
      setTotalCount(warm.total_count);
      setStreamWindowEnd(warm.stream_end_offset);
    }

    streamAbortRef.current?.abort();

    const controller = new AbortController();

    subscribeDashboardLoad(
      filter,
      searchQuery,
      {
        onIndexPage: (page) => {
          if (requestVersionRef.current !== requestVersion) {
            return;
          }
          applyIndexPage(page, requestVersion);
        },
        getLoadedIdCount: () => itemIdsRef.current.length,
        onLoadComplete: () => {
          if (requestVersionRef.current === requestVersion) {
            setIsLoading(false);
          }
        },
        onError: (scope, err) => {
          if (requestVersionRef.current !== requestVersion) {
            return;
          }
          reportServiceError(scope, err);
          setError(err instanceof Error ? err.message : String(err));
          setIsLoading(false);
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
    filterKey,
    searchQuery,
    setLoadedItemIds,
    setStreamWindowEnd,
    vaultId,
    vaultRevision,
  ]);

  useEffect(() => {
    if (!vaultId || isLoading || !itemIds.length || !items.length) {
      return;
    }

    persistTimerRef.current = setTimeout(() => {
      void persistDashboardSnapshot(
        buildDashboardSnapshot({
          vaultId,
          filter,
          search: searchQuery,
          itemIds,
          items,
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
    itemIds,
    items,
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

  return {
    items,
    totalCount,
    isLoading: isLoading || isIndexingEmptyGrid,
    isLoadingMore,
    hasMore: streamEndOffset < totalCount,
    error,
    loadMore,
  };
}
