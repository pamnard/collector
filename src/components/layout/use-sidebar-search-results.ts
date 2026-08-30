import { useEffect, useRef, useState } from "react";
import type { ItemsPort } from "@collector/api";
import type { ItemFile } from "@collector/shared";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import {
  useItemPruneEffect,
  type ItemPruneSignal,
} from "../../hooks/useItemPruneEffect";
import { filterOutItemId } from "../../lib/dashboard-commit";
import { sidebarSearchCacheKey } from "../../lib/sidebar-search-cache-key";
import {
  SIDEBAR_SEARCH_PAGE_SIZE,
  fetchSidebarSearchPage,
  nextSidebarSearchPage,
  sidebarSearchHasMore,
} from "../../lib/sidebar-search-page";
import { getCollectorService } from "../../services/collector-client";

export type UseSidebarSearchResultsInput = {
  searchQuery: string;
  vaultRevision: number;
  itemPruneSignal: ItemPruneSignal | null;
  sidebarSearchLiveSeq: number;
  items?: Pick<ItemsPort, "queryIndex" | "hydrate">;
};

export type UseSidebarSearchResultsResult = {
  debouncedQuery: string;
  results: ItemFile[];
  loadedIdCount: number;
  totalCount: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
};

export function useSidebarSearchResults({
  searchQuery,
  vaultRevision,
  itemPruneSignal,
  sidebarSearchLiveSeq,
  items: itemsOverride,
}: UseSidebarSearchResultsInput): UseSidebarSearchResultsResult {
  const itemsRef = useRef(
    itemsOverride ?? getCollectorService().items,
  );
  itemsRef.current = itemsOverride ?? getCollectorService().items;
  const debouncedQuery = useDebouncedValue(searchQuery, 300);
  const [results, setResults] = useState<ItemFile[]>([]);
  const [loadedIdCount, setLoadedIdCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const softAbortRef = useRef<AbortController | null>(null);
  const lastSoftSeqRef = useRef(sidebarSearchLiveSeq);
  const resultsCacheKey = sidebarSearchCacheKey(
    debouncedQuery.trim(),
    vaultRevision,
  );
  const hasMore = sidebarSearchHasMore(loadedIdCount, totalCount);

  useEffect(() => {
    const query = debouncedQuery.trim();
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = null;
    softAbortRef.current?.abort();
    softAbortRef.current = null;

    if (!query) {
      setResults([]);
      setLoadedIdCount(0);
      setTotalCount(0);
      setError(null);
      setIsLoading(false);
      setIsLoadingMore(false);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setIsLoadingMore(false);
    setError(null);
    setResults([]);
    setLoadedIdCount(0);
    setTotalCount(0);

    void fetchSidebarSearchPage(
      itemsRef.current,
      query,
      nextSidebarSearchPage(0, SIDEBAR_SEARCH_PAGE_SIZE),
      { signal: controller.signal },
    )
      .then((page) => {
        if (controller.signal.aborted) {
          return;
        }
        setResults(page.items);
        setLoadedIdCount(page.fetchedIdCount);
        setTotalCount(page.totalCount);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setResults([]);
        setLoadedIdCount(0);
        setTotalCount(0);
        setIsLoading(false);
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      controller.abort();
    };
    // resultsCacheKey encodes query + vaultRevision (path ids change on move).
  }, [debouncedQuery, resultsCacheKey]);

  // Soft refetch on item*/move/delete without cold loading flash (#756).
  useEffect(() => {
    if (sidebarSearchLiveSeq === lastSoftSeqRef.current) {
      return;
    }
    lastSoftSeqRef.current = sidebarSearchLiveSeq;
    const query = debouncedQuery.trim();
    if (!query || isLoading) {
      return;
    }
    softAbortRef.current?.abort();
    const controller = new AbortController();
    softAbortRef.current = controller;
    const limit = Math.max(loadedIdCount, SIDEBAR_SEARCH_PAGE_SIZE);
    void fetchSidebarSearchPage(
      itemsRef.current,
      query,
      nextSidebarSearchPage(0, limit),
      { signal: controller.signal },
    )
      .then((page) => {
        if (controller.signal.aborted) {
          return;
        }
        setResults(page.items);
        setLoadedIdCount(page.fetchedIdCount);
        setTotalCount(page.totalCount);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      controller.abort();
    };
  }, [sidebarSearchLiveSeq, debouncedQuery, isLoading, loadedIdCount]);

  useItemPruneEffect(itemPruneSignal, (itemId) => {
    setResults((previous) => {
      const next = filterOutItemId(previous, itemId);
      if (next.length === previous.length) {
        return previous;
      }
      // loadedIdCount is the high-water mark / nextOffset for the already-fetched
      // id window — do not decrease on prune (avoids overlapping Load more).
      setTotalCount((total) => Math.max(0, total - 1));
      return next;
    });
  });

  const loadMore = () => {
    const query = debouncedQuery.trim();
    if (!query || isLoading || isLoadingMore || !hasMore) {
      return;
    }
    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;
    setIsLoadingMore(true);
    setError(null);

    void fetchSidebarSearchPage(
      itemsRef.current,
      query,
      nextSidebarSearchPage(loadedIdCount, SIDEBAR_SEARCH_PAGE_SIZE),
      { signal: controller.signal },
    )
      .then((page) => {
        if (controller.signal.aborted) {
          return;
        }
        setResults((previous) => [...previous, ...page.items]);
        setLoadedIdCount((count) => count + page.fetchedIdCount);
        setTotalCount(page.totalCount);
        setIsLoadingMore(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setIsLoadingMore(false);
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  return {
    debouncedQuery,
    results,
    loadedIdCount,
    totalCount,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    loadMore,
  };
}
