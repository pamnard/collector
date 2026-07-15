import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ItemFile } from "@collector/shared";
import { navFilterKey, type NavFilter } from "../types/ui";
import {
  DASHBOARD_PREFETCH_SIZE,
  fetchDashboardIndexPage,
  streamDashboardItems,
  subscribeDashboardLoad,
} from "../services/collector-service";
import { reportServiceError } from "../services/runtime-error";

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

export function useDashboardItems(
  filter: NavFilter,
  searchQuery: string,
  vaultRevision: number,
): UseDashboardItemsResult {
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [itemsById, setItemsById] = useState<Map<string, ItemFile>>(
    () => new Map(),
  );
  const [streamEndOffset, setStreamEndOffset] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestVersionRef = useRef(0);
  const streamEndOffsetRef = useRef(0);
  const itemIdsRef = useRef<string[]>([]);
  const streamAbortRef = useRef<AbortController | null>(null);

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

      if (page.offset === 0) {
        setLoadedItemIds(page.itemIds);
        if (!page.itemIds.length) {
          setStreamWindowEnd(0);
          return;
        }

        const preservedEnd =
          streamEndOffsetRef.current > 0
            ? Math.min(streamEndOffsetRef.current, page.itemIds.length)
            : Math.min(DASHBOARD_PREFETCH_SIZE, page.itemIds.length);
        setStreamWindowEnd(preservedEnd);
        void streamSlice(page.itemIds, 0, preservedEnd, requestVersion);
      }
    },
    [setLoadedItemIds, setStreamWindowEnd, streamSlice],
  );

  const filterKey = navFilterKey(filter);

  useEffect(() => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setIsLoading(true);
    setError(null);
    setItemsById(new Map());
    setLoadedItemIds([]);
    setTotalCount(0);
    setStreamWindowEnd(0);
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
    vaultRevision,
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
    filter,
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
    isLoading,
    isLoadingMore,
    hasMore: streamEndOffset < totalCount,
    error,
    loadMore,
  };
}
