import { useEffect, useRef, useState } from "react";
import { resolveCoverSrc } from "../../utils/item-cover-src";
import {
  isPortraitCoverNaturalSize,
  shouldAttachCoverSrc,
  shouldRunCoverDecodeTimeout,
} from "./item-grid-cover-decode";
import { itemGridCoverSlot } from "./item-grid-cover-slot";

const COVER_DECODE_TIMEOUT_MS = 4_000;

export function useItemGridCover(args: {
  thumbnailPath: string | null | undefined;
  itemUrl: string | undefined;
  optimisticPortrait: boolean;
  /** Near-viewport / sticky priority from IntersectionObserver. */
  decodePriority: boolean;
}): {
  coverSrc: string | null;
  attachSrc: string | null;
  attachCover: boolean;
  coverSettled: boolean;
  isPortraitCover: boolean;
  coverPending: boolean;
  showCover: boolean;
  pathUnresolved: boolean;
  onCoverLoad: (img: HTMLImageElement) => void;
  onCoverError: () => void;
} {
  const { thumbnailPath, itemUrl, optimisticPortrait, decodePriority } = args;
  const [coverSrc, setCoverSrc] = useState<string | null>(null);
  const [coverSettled, setCoverSettled] = useState(false);
  const [isPortraitCover, setIsPortraitCover] = useState(optimisticPortrait);
  const coverSrcRef = useRef(coverSrc);
  const expectedCoverSrcRef = useRef<string | null>(null);
  const settledRef = useRef(false);

  const expectedCoverSrc =
    thumbnailPath === undefined
      ? null
      : resolveCoverSrc(thumbnailPath, itemUrl);
  expectedCoverSrcRef.current = expectedCoverSrc;

  const { coverPending, showCover } = itemGridCoverSlot({
    expectedCoverSrc,
    coverSrc,
    coverSettled,
  });

  const attachCover = shouldAttachCoverSrc({
    nearViewport: decodePriority,
    decodedCoverSrc: coverSrc,
    expectedCoverSrc,
  });
  const attachSrc = showCover
    ? coverSrc
    : attachCover
      ? expectedCoverSrc
      : null;

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

    settledRef.current = false;
    setCoverSrc(null);
    setCoverSettled(false);
    setIsPortraitCover(optimisticPortrait);

    if (!src) {
      settledRef.current = true;
      setCoverSettled(true);
    }
  }, [itemUrl, optimisticPortrait, thumbnailPath]);

  useEffect(() => {
    if (
      !shouldRunCoverDecodeTimeout({
        attachCover,
        coverSettled,
        expectedCoverSrc,
      })
    ) {
      return;
    }

    const src = expectedCoverSrc;
    const timer = setTimeout(() => {
      if (settledRef.current) {
        return;
      }
      console.warn("[ItemGridCard] cover decode timed out", { src });
      settledRef.current = true;
      setCoverSrc(null);
      setCoverSettled(true);
      setIsPortraitCover(false);
    }, COVER_DECODE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [attachCover, coverSettled, expectedCoverSrc]);

  const onCoverLoad = (img: HTMLImageElement) => {
    if (settledRef.current) {
      return;
    }
    const src = expectedCoverSrcRef.current;
    if (src === null) {
      return;
    }
    settledRef.current = true;
    setCoverSrc(src);
    setCoverSettled(true);
    setIsPortraitCover(
      isPortraitCoverNaturalSize(img.naturalWidth, img.naturalHeight),
    );
  };

  const onCoverError = () => {
    if (settledRef.current) {
      return;
    }
    settledRef.current = true;
    setCoverSrc(null);
    setCoverSettled(true);
    setIsPortraitCover(false);
  };

  return {
    coverSrc,
    attachSrc,
    attachCover,
    coverSettled,
    isPortraitCover,
    coverPending,
    showCover,
    pathUnresolved: thumbnailPath === undefined,
    onCoverLoad,
    onCoverError,
  };
}
