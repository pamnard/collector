import { useEffect, useState } from "react";

/**
 * Latch near-viewport via IntersectionObserver.
 * Once true, stays true so a brief scroll-away does not cancel an in-flight cover decode.
 */
export function useNearViewport(options: {
  root?: Element | null;
  rootMargin: string;
}): {
  setNode: (node: Element | null) => void;
  nearViewport: boolean;
} {
  const { root = null, rootMargin } = options;
  const [node, setNode] = useState<Element | null>(null);
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    if (!node || nearViewport) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true);
        }
      },
      { root, rootMargin },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [node, nearViewport, root, rootMargin]);

  return { setNode, nearViewport };
}
