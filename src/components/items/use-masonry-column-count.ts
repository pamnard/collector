import { useEffect, useState } from "react";
import {
  MASONRY_BREAKPOINTS,
  columnCountForWidth,
} from "./masonry-breakpoints";

/**
 * Column count for react-masonry-css as a number so the first paint matches
 * `window.innerWidth` (no default:7 flash before componentDidMount).
 */
export function useMasonryColumnCount(): number {
  const [columnCount, setColumnCount] = useState(() =>
    columnCountForWidth(window.innerWidth, MASONRY_BREAKPOINTS),
  );

  useEffect(() => {
    let frame = 0;
    const update = () => {
      setColumnCount(
        columnCountForWidth(window.innerWidth, MASONRY_BREAKPOINTS),
      );
    };
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return columnCount;
}
