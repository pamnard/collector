import { useCallback, useEffect, useRef, useState } from "react";
import type { ItemFile } from "@collector/shared";
import type { NavFilter } from "../types/ui";
import {
  DASHBOARD_BATCH_SIZE,
  loadDashboardItems,
  listDashboardItemIds,
} from "../services/collector-service";

export { DASHBOARD_BATCH_SIZE };

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
  const [items, setItems] = useState<ItemFile[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestVersionRef = useRef(0);

  useEffect(() => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setIsLoading(true);
    setError(null);
    setItems([]);
    setItemIds([]);

    void (async () => {
      try {
        const ids = await listDashboardItemIds(filter, searchQuery);
        if (requestVersionRef.current !== requestVersion) {
          return;
        }

        setItemIds(ids);
        setTotalCount(ids.length);

        if (!ids.length) {
          setItems([]);
          return;
        }

        const firstBatch = await loadDashboardItems(ids, 0, DASHBOARD_BATCH_SIZE);
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        setItems(firstBatch);
      } catch (err: unknown) {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (requestVersionRef.current === requestVersion) {
          setIsLoading(false);
        }
      }
    })();
  }, [filter, searchQuery, vaultRevision]);

  const loadMore = useCallback(() => {
    if (isLoading || isLoadingMore || items.length >= itemIds.length) {
      return;
    }

    const requestVersion = requestVersionRef.current;
    setIsLoadingMore(true);

    void loadDashboardItems(itemIds, items.length, DASHBOARD_BATCH_SIZE)
      .then((nextBatch) => {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        setItems((current) => [...current, ...nextBatch]);
      })
      .catch((err: unknown) => {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (requestVersionRef.current === requestVersion) {
          setIsLoadingMore(false);
        }
      });
  }, [isLoading, isLoadingMore, itemIds, items.length]);

  return {
    items,
    totalCount,
    isLoading,
    isLoadingMore,
    hasMore: items.length < itemIds.length,
    error,
    loadMore,
  };
}
