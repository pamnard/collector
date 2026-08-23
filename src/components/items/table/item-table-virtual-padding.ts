/** Padding rows for a windowed virtualized table body. */
export function itemTableVirtualPadding(
  virtualRows: ReadonlyArray<{ start: number; end: number }>,
  totalSize: number,
  scrollMargin: number,
): { paddingTop: number; paddingBottom: number } {
  if (virtualRows.length === 0) {
    return { paddingTop: 0, paddingBottom: 0 };
  }

  const first = virtualRows[0]!;
  const last = virtualRows[virtualRows.length - 1]!;

  return {
    paddingTop: Math.max(0, first.start - scrollMargin),
    paddingBottom: Math.max(0, totalSize - last.end),
  };
}
