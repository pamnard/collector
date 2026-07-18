/** Matches historical masonry breakpoints (max-width keys). */
export const DASHBOARD_GRID_BREAKPOINTS = {
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

export function dashboardGridColumnCount(width: number): number {
  const breakpoints = Object.entries(DASHBOARD_GRID_BREAKPOINTS)
    .filter(([key]) => key !== "default")
    .map(([key, cols]) => [Number(key), cols] as const)
    .sort((a, b) => a[0] - b[0]);

  for (const [maxWidth, cols] of breakpoints) {
    if (width <= maxWidth) {
      return cols;
    }
  }
  return DASHBOARD_GRID_BREAKPOINTS.default;
}
