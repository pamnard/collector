/**
 * Atomic cold list reveal: published cover maps + committed items in one
 * flushSync (#855 / #874). Avoids useSyncExternalStore vs useState split paint.
 */

export type RevealHeldListPaintCovers = {
  flushPublished: () => void;
  cancelDeferredPublish: (requestVersion?: number) => void;
};

export type RevealHeldListPaintArgs = {
  requestVersion: number;
  getCurrentVersion: () => number;
  covers: RevealHeldListPaintCovers;
  flushSync: (fn: () => void) => void;
  applyCommitted: () => void;
};

export type RevealHeldListPaintResult = "revealed" | "cancelled-stale";

/**
 * Reveal a held cold paint, or drop only this requestVersion's defer hold.
 */
export function revealHeldListPaint(
  args: RevealHeldListPaintArgs,
): RevealHeldListPaintResult {
  if (args.getCurrentVersion() !== args.requestVersion) {
    args.covers.cancelDeferredPublish(args.requestVersion);
    return "cancelled-stale";
  }
  args.flushSync(() => {
    args.covers.flushPublished();
    args.applyCommitted();
  });
  return "revealed";
}
