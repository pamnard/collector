import { useEffect, useState } from "react";

/** Prefetch margin for masonry cover decode — wider than infinite-scroll sentinel. */
export const NEAR_VIEWPORT_ROOT_MARGIN = "480px";

interface UseNearViewportOptions {
  root?: Element | null;
  rootMargin?: string;
}

export function useNearViewport(
  node: Element | null,
  {
    root = null,
    rootMargin = NEAR_VIEWPORT_ROOT_MARGIN,
  }: UseNearViewportOptions = {},
): boolean {
  // Optimistic true: folder remounts start decode before IntersectionObserver
  // fires. Starting false raced cover defer/clear vs maps publish (Heisenbug:
  // debug fetch delays hid it; every ~5th switch showed empty reserved slots).
  const [near, setNear] = useState(true);

  useEffect(() => {
    if (!node) {
      // Do not flip to false while the ref is not attached yet — that recreated
      // the first-frame defer/clear race on every card mount.
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        setNear(entries.some((entry) => entry.isIntersecting));
      },
      { root, rootMargin },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [node, root, rootMargin]);

  return near;
}

/** Ref callback + near-viewport flag for masonry cards. */
export function useNearViewportRef(
  options: UseNearViewportOptions = {},
): {
  ref: (node: Element | null) => void;
  nearViewport: boolean;
} {
  const [node, setNode] = useState<Element | null>(null);
  const nearViewport = useNearViewport(node, options);
  return { ref: setNode, nearViewport };
}
