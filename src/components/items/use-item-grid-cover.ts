import { useCallback, useEffect, useRef, useState } from "react";
import { resolveCoverSrc } from "../../utils/item-cover-src";
import {
  ITEM_GRID_COVER_DECODE_TIMEOUT_MS,
  isPortraitNaturalSize,
  planItemGridCoverDecode,
} from "./item-grid-cover-decode";
import { itemGridCoverSlot } from "./item-grid-cover-slot";

export function useItemGridCover(args: {
  thumbnailPath: string | null | undefined;
  itemUrl: string | undefined;
  optimisticPortrait: boolean;
  /** Near-viewport cards decode; offscreen cards defer until scroll. */
  shouldDecode: boolean;
}): {
  coverSrc: string | null;
  coverSettled: boolean;
  isPortraitCover: boolean;
  coverPending: boolean;
  showCover: boolean;
  loadCover: boolean;
  pathUnresolved: boolean;
  onCoverImgLoad: (img: HTMLImageElement) => void;
  onCoverImgError: () => void;
} {
  const { thumbnailPath, itemUrl, optimisticPortrait, shouldDecode } = args;
  const [coverSrc, setCoverSrc] = useState<string | null>(null);
  const [coverSettled, setCoverSettled] = useState(false);
  const [isPortraitCover, setIsPortraitCover] = useState(optimisticPortrait);
  const coverSrcRef = useRef(coverSrc);
  const coverSettledRef = useRef(coverSettled);

  const expectedCoverSrc =
    thumbnailPath === undefined
      ? null
      : resolveCoverSrc(thumbnailPath, itemUrl);
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
      thumbnailPath === undefined
        ? null
        : resolveCoverSrc(thumbnailPath, itemUrl);
    const plan = planItemGridCoverDecode({
      thumbnailPath,
      resolvedSrc,
      shouldDecode,
      currentSrc: coverSrcRef.current,
      currentSettled: coverSettledRef.current,
    });

    if (plan.kind === "wait-path") {
      return;
    }

    if (plan.kind === "settled-empty") {
      setCoverSrc(null);
      setCoverSettled(true);
      setIsPortraitCover(false);
      return;
    }

    if (plan.kind === "defer") {
      setCoverSrc(null);
      setCoverSettled(false);
      setIsPortraitCover(optimisticPortrait);
      return;
    }

    setCoverSrc(plan.src);
    setCoverSettled(false);
    setIsPortraitCover(optimisticPortrait);
  }, [itemUrl, optimisticPortrait, shouldDecode, thumbnailPath]);

  useEffect(() => {
    if (!loadCover || !shouldDecode) {
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
      setIsPortraitCover(false);
    }, ITEM_GRID_COVER_DECODE_TIMEOUT_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [coverSrc, loadCover, shouldDecode]);

  const onCoverImgLoad = useCallback((img: HTMLImageElement) => {
    setCoverSrc(img.currentSrc || img.src);
    setCoverSettled(true);
    setIsPortraitCover(isPortraitNaturalSize(img));
  }, []);

  const onCoverImgError = useCallback(() => {
    setCoverSrc(null);
    setCoverSettled(true);
    setIsPortraitCover(false);
  }, []);

  return {
    coverSrc,
    coverSettled,
    isPortraitCover,
    coverPending,
    showCover,
    loadCover,
    pathUnresolved: thumbnailPath === undefined,
    onCoverImgLoad,
    onCoverImgError,
  };
}
