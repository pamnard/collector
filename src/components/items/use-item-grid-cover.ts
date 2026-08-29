import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  dashboardPerfGetActiveRunId,
  dashboardPerfRecordCoverDecode,
  isDashboardPerfEnabled,
} from "../../lib/dashboard-perf";
import {
  isDashboardGridWarmActive,
  subscribeDashboardGridWarm,
} from "../../lib/dashboard-grid-warm";
import { imageDisplaySlotById } from "../../lib/image-slot-fit";
import { buildDerivedImageAttrs } from "../../utils/derived-image-src";
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

const GRID_SLOT_CSS_WIDTH_PX = imageDisplaySlotById("dashboard-grid").cssWidthPx;

function derivedCoverAttrs(thumbnailPath: string | null | undefined): {
  src: string | null;
  srcSet: string | null;
  sizes: string | null;
} {
  if (thumbnailPath === undefined || thumbnailPath === null) {
    return { src: null, srcSet: null, sizes: null };
  }
  const attrs = buildDerivedImageAttrs({
    displayPath: thumbnailPath,
    slotCssWidthPx: GRID_SLOT_CSS_WIDTH_PX,
  });
  if (!attrs.src) {
    return { src: null, srcSet: null, sizes: null };
  }
  return { src: attrs.src, srcSet: attrs.srcSet, sizes: attrs.sizes };
}

export function useItemGridCover(args: {
  thumbnailPath: string | null | undefined;
  /** Near-viewport cards decode; offscreen cards defer until scroll. */
  shouldDecode: boolean;
}): {
  coverSrc: string | null;
  coverSrcSet: string | null;
  coverSizes: string | null;
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
  const [coverSrcSet, setCoverSrcSet] = useState<string | null>(null);
  const [coverSizes, setCoverSizes] = useState<string | null>(null);
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

  const expectedAttrs = useMemo(
    () => derivedCoverAttrs(thumbnailPath),
    [thumbnailPath],
  );
  const { coverPending, showCover, loadCover } = itemGridCoverSlot({
    expectedCoverSrc: expectedAttrs.src,
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
    const plan = planItemGridCoverDecode({
      thumbnailPath,
      resolvedSrc: expectedAttrs.src,
      shouldDecode: decodeCovers,
      currentSrc: coverSrcRef.current,
      currentSettled: coverSettledRef.current,
    });

    if (plan.kind === "wait-path") {
      return;
    }

    if (plan.kind === "settled-empty") {
      setCoverSrc(null);
      setCoverSrcSet(null);
      setCoverSizes(null);
      setCoverSettled(true);
      setCoverPixelSize(null);
      return;
    }

    if (plan.kind === "defer") {
      setCoverSrc(null);
      setCoverSrcSet(null);
      setCoverSizes(null);
      setCoverSettled(false);
      setCoverPixelSize(null);
      return;
    }

    setCoverSrc(plan.src);
    setCoverSrcSet(expectedAttrs.srcSet);
    setCoverSizes(expectedAttrs.sizes);
    setCoverSettled(false);
    setCoverPixelSize(null);
  }, [decodeCovers, expectedAttrs, thumbnailPath]);

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
      setCoverSrcSet(null);
      setCoverSizes(null);
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
    setCoverSrcSet(null);
    setCoverSizes(null);
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
    coverSrcSet,
    coverSizes,
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
