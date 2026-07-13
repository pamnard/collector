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

function mergeItemIds(indexIds: string[], diskIds: Iterable<string>): string[] {
  const merged = [...indexIds];
  const seen = new Set(indexIds);
  for (const id of diskIds) {
    if (!seen.has(id)) {
      seen.add(id);
      merged.push(id);
    }
  }
  return merged;
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
  const [diskItemIds, setDiskItemIds] = useState<string[]>([]);
  const [streamEndOffset, setStreamEndOffset] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestVersionRef = useRef(0);
  const streamEndOffsetRef = useRef(0);
  const streamAbortRef = useRef<AbortController | null>(null);
  const indexIdsRef = useRef<string[] | null>(null);
  const diskItemIdsRef = useRef<string[]>([]);

  const items = useMemo(() => {
    const ordered: ItemFile[] = [];
    const seen = new Set<string>();

    if (itemIds.length > 0) {
      for (const id of itemIds.slice(0, streamEndOffset)) {
        const item = itemsById.get(id);
        if (item) {
          ordered.push(item);
          seen.add(id);
        }
      }
    }

    for (const id of diskItemIds) {
      if (seen.has(id)) {
        continue;
      }
      const item = itemsById.get(id);
      if (item) {
        ordered.push(item);
        seen.add(id);
      }
    }

    return ordered;
  }, [diskItemIds, itemIds, itemsById, streamEndOffset]);

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

  const publishMergedIds = useCallback(
    (indexIds: string[] | null, diskIds: string[]) => {
      const merged = mergeItemIds(indexIds ?? [], diskIds);
      setItemIds(merged);
      setTotalCount(merged.length);
      return merged;
    },
    [],
  );

  const applyIndexIds = useCallback(
    (indexIds: string[], requestVersion: number) => {
      indexIdsRef.current = indexIds;
      const merged = publishMergedIds(indexIds, diskItemIdsRef.current);

      if (!merged.length) {
        return;
      }

      const windowEnd = Math.min(
        Math.max(streamEndOffsetRef.current, DASHBOARD_PREFETCH_SIZE),
        merged.length,
      );
      if (streamEndOffsetRef.current === 0) {
        setStreamWindowEnd(windowEnd);
      }

      void streamSlice(merged, 0, windowEnd, requestVersion);
    },
    [publishMergedIds, setStreamWindowEnd, streamSlice],
  );

  useEffect(() => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setIsLoading(true);
    setError(null);
    setItemsById(new Map());
    setDiskItemIds([]);
    diskItemIdsRef.current = [];
    setItemIds([]);
    setTotalCount(0);
    indexIdsRef.current = null;
    setStreamWindowEnd(0);
    streamAbortRef.current?.abort();

    const controller = new AbortController();
    let hasVisibleData = false;
    let indexSettled = false;
    let diskSettled = false;

    const markVisible = () => {
      if (!hasVisibleData) {
        hasVisibleData = true;
        if (requestVersionRef.current === requestVersion) {
          setIsLoading(false);
        }
      }
    };

    const maybeFinishLoading = () => {
      if (
        indexSettled &&
        diskSettled &&
        !hasVisibleData &&
        requestVersionRef.current === requestVersion
      ) {
        setIsLoading(false);
      }
    };

    subscribeDashboardLoad(
      filter,
      searchQuery,
      {
        onIndexIds: (indexIds) => {
          if (requestVersionRef.current !== requestVersion) {
            return;
          }
          indexSettled = true;
          if (indexIds.length > 0) {
            markVisible();
          }
          applyIndexIds(indexIds, requestVersion);
          maybeFinishLoading();
        },
        onDiskItem: (item) => {
          if (requestVersionRef.current !== requestVersion) {
            return;
          }
          markVisible();
          setItemsById((current) => {
            const next = new Map(current);
            next.set(item.id, item);
            return next;
          });
          setDiskItemIds((current) => {
            if (current.includes(item.id)) {
              return current;
            }
            const next = [...current, item.id];
            diskItemIdsRef.current = next;
            publishMergedIds(indexIdsRef.current, next);
            return next;
          });
        },
        onDiskComplete: () => {
          if (requestVersionRef.current !== requestVersion) {
            return;
          }
          diskSettled = true;
          maybeFinishLoading();
        },
        onError: (scope, err) => {
          if (requestVersionRef.current !== requestVersion) {
            return;
          }
          reportServiceError(scope, err);
          setError(err instanceof Error ? err.message : String(err));
        },
      },
      controller.signal,
    );

    return () => {
      controller.abort();
      streamAbortRef.current?.abort();
    };
  }, [applyIndexIds, filter, publishMergedIds, searchQuery, setStreamWindowEnd, vaultRevision]);

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
