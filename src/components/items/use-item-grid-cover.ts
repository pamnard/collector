import { useEffect, useRef, useState } from "react";
import { resolveCoverSrc } from "../../utils/item-cover-src";
import {
  applyCoverDecodeFail,
  applyCoverDecodeLoad,
  isCoverImgEventForSrc,
  shouldAttachCoverSrc,
  shouldRunCoverDecodeTimeout,
} from "./item-grid-cover-decode";
import { itemGridCoverSlot } from "./item-grid-cover-slot";

const COVER_DECODE_TIMEOUT_MS = 4_000;

export function useItemGridCover(args: {
  thumbnailPath: string | null | undefined;
  itemUrl: string | undefined;
  optimisticPortrait: boolean;
  /** Near-viewport priority from IntersectionObserver. */
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
  onCoverError: (img: HTMLImageElement) => void;
} {
  const { thumbnailPath, itemUrl, optimisticPortrait, decodePriority } = args;
  const [coverSrc, setCoverSrc] = useState<string | null>(null);
  const [coverSettled, setCoverSettled] = useState(false);
  const [isPortraitCover, setIsPortraitCover] = useState(optimisticPortrait);
  const coverSrcRef = useRef(coverSrc);
  const expectedCoverSrcRef = useRef<string | null>(null);
  const settledRef = useRef(false);
  const flightIdRef = useRef(0);

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

    flightIdRef.current += 1;
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
    const eventFlightId = flightIdRef.current;
    const timer = setTimeout(() => {
      const failed = applyCoverDecodeFail({
        flightId: flightIdRef.current,
        eventFlightId,
      });
      if (failed === null || settledRef.current) {
        return;
      }
      console.warn("[ItemGridCard] cover decode timed out", { src });
      settledRef.current = true;
      setCoverSrc(failed.coverSrc);
      setCoverSettled(true);
      setIsPortraitCover(failed.isPortrait);
    }, COVER_DECODE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [attachCover, coverSettled, expectedCoverSrc]);

  const onCoverLoad = (img: HTMLImageElement) => {
    if (settledRef.current) {
      return;
    }
    const loaded = applyCoverDecodeLoad({
      flightId: flightIdRef.current,
      eventFlightId: flightIdRef.current,
      expectedSrc: expectedCoverSrcRef.current,
      imgSrcAttr: img.getAttribute("src"),
      width: img.naturalWidth,
      height: img.naturalHeight,
    });
    if (loaded === null) {
      return;
    }
    settledRef.current = true;
    setCoverSrc(loaded.coverSrc);
    setCoverSettled(true);
    setIsPortraitCover(loaded.isPortrait);
  };

  const onCoverError = (img: HTMLImageElement) => {
    if (settledRef.current) {
      return;
    }
    if (
      !isCoverImgEventForSrc(
        img.getAttribute("src"),
        expectedCoverSrcRef.current,
      )
    ) {
      return;
    }
    const failed = applyCoverDecodeFail({
      flightId: flightIdRef.current,
      eventFlightId: flightIdRef.current,
    });
    if (failed === null) {
      return;
    }
    settledRef.current = true;
    setCoverSrc(failed.coverSrc);
    setCoverSettled(true);
    setIsPortraitCover(failed.isPortrait);
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
