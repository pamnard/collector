import { useEffect, useRef } from "react";

interface UseInfiniteScrollOptions {
  enabled: boolean;
  hasMore: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
  rootMargin?: string;
}

export function useInfiniteScroll({
  enabled,
  hasMore,
  isLoading,
  onLoadMore,
  rootMargin = "240px",
}: UseInfiniteScrollOptions): (node: Element | null) => void {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const onLoadMoreRef = useRef(onLoadMore);

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  return (node) => {
    observerRef.current?.disconnect();
    observerRef.current = null;

    if (!node || !enabled || !hasMore) {
      return;
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !isLoading) {
          onLoadMoreRef.current();
        }
      },
      { rootMargin },
    );

    observerRef.current.observe(node);
  };
}
