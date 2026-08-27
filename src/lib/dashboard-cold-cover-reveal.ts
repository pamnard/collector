/**
 * Cold first-window reveal (#855): hold ItemGridCard paint until cover maps
 * for the window are ready, then commit items + maps in one update.
 */
export function shouldDeferListPaintUntilCovers(
  blockOnCovers: boolean,
): boolean {
  return blockOnCovers;
}
