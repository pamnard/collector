import { useEffect, useState } from "react";
import {
  COVER_DECODE_ROOT_MARGIN,
  shouldObserveNearViewport,
} from "./item-grid-cover-decode";

/**
 * Near-viewport flag for masonry cover decode.
 * Observes only after the masonry scroll root exists (no viewport fallback).
 * Not sticky: leaving the prefetch band cancels an unsettled decode.
 */
export function useNearViewport(
  root: Element | null,
  rootMargin: string = COVER_DECODE_ROOT_MARGIN,
): [(node: Element | null) => void, boolean] {
  const [node, setNode] = useState<Element | null>(null);
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    const target = { node, root };
    if (!shouldObserveNearViewport(target)) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        setNearViewport(entries.some((entry) => entry.isIntersecting));
      },
      { root: target.root, rootMargin },
    );
    observer.observe(target.node);
    return () => observer.disconnect();
  }, [node, root, rootMargin]);

  return [setNode, nearViewport];
}
