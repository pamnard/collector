/** Pure cover-slot flags for ItemGridCard (keeps failed loads from sticky gray teasers). */
export function itemGridCoverSlot(args: {
  expectedCoverSrc: string | null;
  coverSrc: string | null;
  coverSettled: boolean;
}): { coverPending: boolean; showCover: boolean; loadCover: boolean } {
  const coverPending = Boolean(args.expectedCoverSrc) && !args.coverSettled;
  const showCover = Boolean(args.coverSrc && args.coverSettled);
  const loadCover = Boolean(args.coverSrc) && !args.coverSettled;
  return { coverPending, showCover, loadCover };
}

/** Reserve a cover teaser while paths resolve — image/video only, not notes. */
export function itemGridCoverSlotPending(args: {
  coverPending: boolean;
  pathUnresolved: boolean;
  optimisticPortrait: boolean;
}): boolean {
  return (
    args.coverPending || (args.pathUnresolved && args.optimisticPortrait)
  );
}

/**
 * Cover `<img>` layout classes.
 * While decode is in flight (`loadCover`), keep the img out of document flow so the
 * aspect-ratio placeholder alone owns teaser height (avoids image+placeholder
 * masonry jumps when the browser already knows intrinsic dimensions).
 */
export function itemGridCoverImgClassName(args: { loadCover: boolean }): string {
  if (args.loadCover) {
    return "absolute inset-0 h-full w-full opacity-0";
  }
  return "h-auto w-full";
}
