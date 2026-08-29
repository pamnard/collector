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
  return { src: attrs.src, srcSet: attrs.srcSet, sizes: attrs.sizes };
}

function clearCoverDecodeState(setters: {
  setCoverSrc: (v: string | null) => void;
  setCoverSrcSet: (v: string | null) => void;
  setCoverSizes: (v: string | null) => void;
  setCoverSettled: (v: boolean) => void;
  setCoverPixelSize: (v: ItemGridCoverPixelSize | null) => void;
  settled: boolean;
}): void {
  setters.setCoverSrc(null);
  setters.setCoverSrcSet(null);
  setters.setCoverSizes(null);
  setters.setCoverSettled(setters.settled);
  setters.setCoverPixelSize(null);
}

export function useItemGridCover(args: {
  thumbnailPath: string | null | undefined;
  /**
   * Host-reserved WxH from cover maps. Decode must not start without it (#913)
   * — otherwise the card paints a 1px img and grows when natural size arrives.
   */
  reservedPixelSize: ItemGridCoverPixelSize | null;
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
  const { thumbnailPath, reservedPixelSize, shouldDecode } = args;
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

  const hasReservedSlot =
    reservedPixelSize != null &&
    reservedPixelSize.width > 0 &&
    reservedPixelSize.height > 0;
  // Near-viewport / warm decode only inside an already-reserved slot (#913).
  const decodeCovers = (shouldDecode || warmDecode) && hasReservedSlot;

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
    // Maps collapsed / path unresolved.
    // If the host still reserves WxH (latched), keep decode state — clearing
    // kills painted covers and leaves perpetual pulse while maps flicker (#913/#877).
    // Only clear when there is no reserved slot (would paint <img> without aspect).
    if (thumbnailPath === undefined) {
      if (!hasReservedSlot) {
        clearCoverDecodeState({
          setCoverSrc,
          setCoverSrcSet,
          setCoverSizes,
          setCoverSettled,
          setCoverPixelSize,
          settled: false,
        });
      }
      return;
    }

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
      clearCoverDecodeState({
        setCoverSrc,
        setCoverSrcSet,
        setCoverSizes,
        setCoverSettled,
        setCoverPixelSize,
        settled: true,
      });
      return;
    }

    if (plan.kind === "defer") {
      // Offscreen: do not start decode. Avoid setState thrash when already idle —
      // clearing on every remount raced the observer and wiped the next decode.
      if (coverSrcRef.current != null || coverSettledRef.current) {
        clearCoverDecodeState({
          setCoverSrc,
          setCoverSrcSet,
          setCoverSizes,
          setCoverSettled,
          setCoverPixelSize,
          settled: false,
        });
      }
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
      clearCoverDecodeState({
        setCoverSrc,
        setCoverSrcSet,
        setCoverSizes,
        setCoverSettled,
        setCoverPixelSize,
        settled: true,
      });
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
    clearCoverDecodeState({
      setCoverSrc,
      setCoverSrcSet,
      setCoverSizes,
      setCoverSettled,
      setCoverPixelSize,
      settled: true,
    });
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
