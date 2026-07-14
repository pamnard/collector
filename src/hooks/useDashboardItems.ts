import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ItemFile } from "@collector/shared";
import type { NavFilter } from "../types/ui";
import {
  DASHBOARD_PREFETCH_SIZE,
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

  const applyIndexIds = useCallback(
    (indexIds: string[], requestVersion: number) => {
      setItemIds(indexIds);
      setTotalCount(indexIds.length);

      if (!indexIds.length) {
        setStreamWindowEnd(0);
        return;
      }

      const windowEnd = Math.min(
        Math.max(streamEndOffsetRef.current, DASHBOARD_PREFETCH_SIZE),
        indexIds.length,
      );
      if (streamEndOffsetRef.current === 0) {
        setStreamWindowEnd(windowEnd);
      } else if (streamEndOffsetRef.current > indexIds.length) {
        setStreamWindowEnd(indexIds.length);
      }

      void streamSlice(indexIds, 0, windowEnd, requestVersion);
    },
    [setStreamWindowEnd, streamSlice],
  );

  useEffect(() => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setIsLoading(true);
    setError(null);
    setItemsById(new Map());
    setItemIds([]);
    setTotalCount(0);
    setStreamWindowEnd(0);
    streamAbortRef.current?.abort();

    const controller = new AbortController();

    subscribeDashboardLoad(
      filter,
      searchQuery,
      {
        onIndexIds: (indexIds) => {
          if (requestVersionRef.current !== requestVersion) {
            return;
          }
          applyIndexIds(indexIds, requestVersion);
        },
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
  }, [applyIndexIds, filter, searchQuery, setStreamWindowEnd, vaultRevision]);

  const loadMore = useCallback(() => {
    if (isLoading || isLoadingMore || streamEndOffset >= itemIds.length) {
      return;
    }

    const requestVersion = requestVersionRef.current;
    const offset = streamEndOffset;
    const limit = Math.min(
      DASHBOARD_PREFETCH_SIZE,
      itemIds.length - streamEndOffset,
    );
    const nextEnd = offset + limit;

    setIsLoadingMore(true);
    setStreamWindowEnd(nextEnd);

    void streamSlice(itemIds, offset, limit, requestVersion)
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
  }, [
    isLoading,
    isLoadingMore,
    itemIds,
    setStreamWindowEnd,
    streamEndOffset,
    streamSlice,
  ]);

  return {
    items,
    totalCount,
    isLoading,
    isLoadingMore,
    hasMore: streamEndOffset < itemIds.length,
    error,
    loadMore,
  };
}
