/**
 * Returns a stable function that always invokes the latest `getCurrent()` target.
 * Use when a long-lived publisher (e.g. item chrome header) must not close over
 * stale action handlers from an earlier render.
 */
export function liveCallback<Args extends unknown[], R>(
  getCurrent: () => (...args: Args) => R,
): (...args: Args) => R {
  return (...args: Args) => getCurrent()(...args);
}
