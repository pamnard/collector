import { useEffect, useRef, useState } from "react";

interface UseInfiniteScrollOptions {
  enabled: boolean;
  hasMore: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
  /** Scrollport that owns the sentinel; required when not the viewport. */
  root?: Element | null;
  rootMargin?: string;
}

export function useInfiniteScroll({
  enabled,
  hasMore,
  isLoading,
  onLoadMore,
  root = null,
  rootMargin = "240px",
}: UseInfiniteScrollOptions): (node: Element | null) => void {
  const [node, setNode] = useState<Element | null>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  const isLoadingRef = useRef(isLoading);

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    if (!node || !enabled || !hasMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some((entry) => entry.isIntersecting) &&
          !isLoadingRef.current
        ) {
          onLoadMoreRef.current();
        }
      },
      { root, rootMargin },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [node, enabled, hasMore, root, rootMargin]);

  return setNode;
}
