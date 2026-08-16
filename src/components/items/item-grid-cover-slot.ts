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

/**
 * Cover `<img>` layout classes.
 * Settled covers own teaser height via intrinsic size (`h-auto`).
 * In-flight decode uses a detached 1×1 img in ItemGridCard — not this helper.
 */
export function itemGridCoverImgClassName(args: { loadCover: boolean }): string {
  if (args.loadCover) {
    return "absolute inset-0 h-full w-full opacity-0";
  }
  return "h-auto w-full";
}
