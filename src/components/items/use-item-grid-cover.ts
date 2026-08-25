import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  dashboardPerfGetActiveRunId,
  dashboardPerfRecordCoverDecode,
  isDashboardPerfEnabled,
} from "../../lib/dashboard-perf";
import {
  isDashboardGridWarmActive,
  subscribeDashboardGridWarm,
} from "../../lib/dashboard-grid-warm";
import { resolveCoverSrc } from "../../utils/item-cover-src";
import {
  ITEM_GRID_COVER_DECODE_TIMEOUT_MS,
  planItemGridCoverDecode,
  settleDomImgCoverDecode,
} from "./item-grid-cover-decode";
import {
  itemGridCoverPixelSizeFromImg,
  itemGridCoverSlot,
  type ItemGridCoverPixelSize,
} from "./item-grid-cover-slot";

export function useItemGridCover(args: {
  thumbnailPath: string | null | undefined;
  /** Near-viewport cards decode; offscreen cards defer until scroll. */
  shouldDecode: boolean;
}): {
  coverSrc: string | null;
  coverSettled: boolean;
  coverPixelSize: ItemGridCoverPixelSize | null;
  coverPending: boolean;
  showCover: boolean;
  loadCover: boolean;
  onCoverImgLoad: (img: HTMLImageElement) => void;
  onCoverImgError: () => void;
  onCoverImgRef: (img: HTMLImageElement | null) => void;
} {
  const { thumbnailPath, shouldDecode } = args;
  const [coverSrc, setCoverSrc] = useState<string | null>(null);
  const [coverSettled, setCoverSettled] = useState(false);
  const [coverPixelSize, setCoverPixelSize] =
    useState<ItemGridCoverPixelSize | null>(null);
  const warmDecode = useSyncExternalStore(
    subscribeDashboardGridWarm,
    isDashboardGridWarmActive,
    isDashboardGridWarmActive,
  );
  const coverSrcRef = useRef(coverSrc);
  const coverSettledRef = useRef(coverSettled);

  const decodeCovers = shouldDecode || warmDecode;

  const expectedCoverSrc =
    thumbnailPath === undefined ? null : resolveCoverSrc(thumbnailPath);
  const { coverPending, showCover, loadCover } = itemGridCoverSlot({
    expectedCoverSrc,
    coverSrc,
    coverSettled,
  });

  useEffect(() => {
    coverSrcRef.current = coverSrc;
  }, [coverSrc]);

  useEffect(() => {
    coverSettledRef.current = coverSettled;
  }, [coverSettled]);

  useEffect(() => {
    const resolvedSrc =
      thumbnailPath === undefined ? null : resolveCoverSrc(thumbnailPath);
    const plan = planItemGridCoverDecode({
      thumbnailPath,
      resolvedSrc,
      shouldDecode: decodeCovers,
      currentSrc: coverSrcRef.current,
      currentSettled: coverSettledRef.current,
    });

    if (plan.kind === "wait-path") {
      return;
    }

    if (plan.kind === "settled-empty") {
      setCoverSrc(null);
      setCoverSettled(true);
      setCoverPixelSize(null);
      return;
    }

    if (plan.kind === "defer") {
      setCoverSrc(null);
      setCoverSettled(false);
      setCoverPixelSize(null);
      return;
    }

    setCoverSrc(plan.src);
    setCoverSettled(false);
    setCoverPixelSize(null);
  }, [decodeCovers, thumbnailPath]);

  useEffect(() => {
    // Timeout follows in-flight loadCover even after leaving the near zone
    // (decode is latched until settle — see planItemGridCoverDecode).
    if (!loadCover) {
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) {
        return;
      }
      console.warn("[ItemGridCard] cover decode timed out", { src: coverSrc });
      setCoverSrc(null);
      setCoverSettled(true);
      setCoverPixelSize(null);
    }, ITEM_GRID_COVER_DECODE_TIMEOUT_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [coverSrc, loadCover]);

  const onCoverImgLoad = useCallback((img: HTMLImageElement) => {
    setCoverSrc(img.currentSrc || img.src);
    setCoverSettled(true);
    setCoverPixelSize(itemGridCoverPixelSizeFromImg(img));
    if (isDashboardPerfEnabled()) {
      dashboardPerfRecordCoverDecode(dashboardPerfGetActiveRunId());
    }
  }, []);

  const onCoverImgError = useCallback(() => {
    setCoverSrc(null);
    setCoverSettled(true);
    setCoverPixelSize(null);
  }, []);

  const onCoverImgRef = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img) {
        return;
      }
      settleDomImgCoverDecode(img, {
        onLoad: onCoverImgLoad,
        onError: onCoverImgError,
      });
    },
    [onCoverImgError, onCoverImgLoad],
  );

  return {
    coverSrc,
    coverSettled,
    coverPixelSize,
    coverPending,
    showCover,
    loadCover,
    onCoverImgLoad,
    onCoverImgError,
    onCoverImgRef,
  };
}
