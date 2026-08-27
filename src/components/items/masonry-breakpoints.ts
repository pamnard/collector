/** Same breakpoints as collector.tools Django frontend (Dashboard.tsx). */
export const MASONRY_BREAKPOINTS = {
  default: 7,
  3440: 7,
  2560: 6,
  2240: 5,
  1920: 4,
  1536: 3,
  1280: 3,
  768: 2,
  500: 1,
} as const;

export type MasonryBreakpointCols = {
  default: number;
  [breakpoint: number]: number;
};

/**
 * Same match as react-masonry-css `reCalculateColumnCount`:
 * among keys with width ≤ breakpoint, pick the smallest breakpoint’s columns;
 * else `default`.
 */
export function columnCountForWidth(
  width: number,
  breakpointCols: MasonryBreakpointCols = MASONRY_BREAKPOINTS,
): number {
  let matchedBreakpoint = Infinity;
  let columns = breakpointCols.default;

  for (const breakpoint of Object.keys(breakpointCols)) {
    const optBreakpoint = Number.parseInt(breakpoint, 10);
    const isCurrentBreakpoint =
      optBreakpoint > 0 && width <= optBreakpoint;

    if (isCurrentBreakpoint && optBreakpoint < matchedBreakpoint) {
      matchedBreakpoint = optBreakpoint;
      columns = breakpointCols[optBreakpoint]!;
    }
  }

  return Math.max(1, Number.parseInt(String(columns), 10) || 1);
}
