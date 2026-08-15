import { useEffect, useState } from "react";
import { COVER_DECODE_ROOT_MARGIN } from "./item-grid-cover-decode";

/**
 * Sticky near-viewport flag for masonry cover decode.
 * Once the card intersects the prefetch band it stays true so we do not
 * cancel an in-flight decode or unload a decoded cover.
 */
export function useNearViewport(
  root: Element | null,
  rootMargin: string = COVER_DECODE_ROOT_MARGIN,
): [(node: Element | null) => void, boolean] {
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
  }, [nearViewport, node, root, rootMargin]);

  return [setNode, nearViewport];
}
