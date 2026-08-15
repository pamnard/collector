import { useEffect, useRef, useState } from "react";
import { COVER_DOMINANT_RATIO } from "../../lib/teaser-layout/cover-image-form";
import { resolveCoverSrc } from "../../utils/item-cover-src";
import {
  shouldProbeCoverPixels,
  shouldSettleCoverWithoutProbe,
} from "./item-grid-cover-decode";
import { itemGridCoverSlot } from "./item-grid-cover-slot";

function isPortraitNaturalSize(img: HTMLImageElement): boolean {
  if (img.naturalWidth === 0) {
    return false;
  }
  return img.naturalHeight / img.naturalWidth >= COVER_DOMINANT_RATIO;
}

export function useItemGridCover(args: {
  thumbnailPath: string | null | undefined;
  itemUrl: string | undefined;
  optimisticPortrait: boolean;
  /** When false, skip Image() probe so offscreen masonry cards do not contend. */
  nearViewport: boolean;
}): {
  coverSrc: string | null;
  coverSettled: boolean;
  isPortraitCover: boolean;
  coverPending: boolean;
  showCover: boolean;
  pathUnresolved: boolean;
} {
  const { thumbnailPath, itemUrl, optimisticPortrait, nearViewport } = args;
  const [coverSrc, setCoverSrc] = useState<string | null>(null);
  const [coverSettled, setCoverSettled] = useState(false);
  const [isPortraitCover, setIsPortraitCover] = useState(optimisticPortrait);
  const coverSrcRef = useRef(coverSrc);

  const expectedCoverSrc =
    thumbnailPath === undefined
      ? null
      : resolveCoverSrc(thumbnailPath, itemUrl);
  const { coverPending, showCover } = itemGridCoverSlot({
    expectedCoverSrc,
    coverSrc,
    coverSettled,
  });

  useEffect(() => {
    coverSrcRef.current = coverSrc;
  }, [coverSrc]);

  useEffect(() => {
    // Path still resolving — wait; do not tear down chrome once path is known.
    if (thumbnailPath === undefined) {
      return;
    }

    const src = resolveCoverSrc(thumbnailPath, itemUrl);
    // Skip only when the same successful src is already shown (ref holds coverSrc).
    if (src !== null && src === coverSrcRef.current) {
      return;
    }

    setCoverSrc(null);
    setCoverSettled(false);
    setIsPortraitCover(optimisticPortrait);

    if (shouldSettleCoverWithoutProbe({ thumbnailPath, coverSrc: src })) {
      setCoverSettled(true);
      return;
    }

    if (!shouldProbeCoverPixels({ nearViewport, coverSrc: src })) {
      // Offscreen with a known cover URL: keep pending placeholder, no decode yet.
      return;
    }

    let cancelled = false;
    let settled = false;
    const img = new Image();
    const finish = (next: { src: string | null; portrait: boolean }) => {
      if (cancelled || settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      setCoverSrc(next.src);
      setCoverSettled(true);
      setIsPortraitCover(next.portrait);
    };
    const timer = setTimeout(() => {
      console.warn("[ItemGridCard] cover decode timed out", { src });
      finish({ src: null, portrait: false });
    }, 4_000);
    img.onload = () => {
      finish({
        src,
        portrait: isPortraitNaturalSize(img),
      });
    };
    img.onerror = () => {
      finish({ src: null, portrait: false });
    };
    img.src = src!;

    return () => {
      cancelled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
    };
  }, [itemUrl, nearViewport, optimisticPortrait, thumbnailPath]);

  return {
    coverSrc,
    coverSettled,
    isPortraitCover,
    coverPending,
    showCover,
    pathUnresolved: thumbnailPath === undefined,
  };
}
