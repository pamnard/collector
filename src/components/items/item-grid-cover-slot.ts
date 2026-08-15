/** Pure cover-slot flags for ItemGridCard (keeps failed loads from sticky gray teasers). */
export function itemGridCoverSlot(args: {
  expectedCoverSrc: string | null;
  coverSrc: string | null;
  coverSettled: boolean;
}): { coverPending: boolean; showCover: boolean } {
  return {
    coverPending: Boolean(args.expectedCoverSrc) && !args.coverSettled,
    showCover: Boolean(args.coverSrc && args.coverSettled),
  };
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
