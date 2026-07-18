import type { ItemFile } from "@collector/shared";

/** Ordered dashboard cards for the current stream window. */
export function orderDashboardItems(
  itemIds: string[],
  itemsById: ReadonlyMap<string, ItemFile>,
  streamEndOffset: number,
): ItemFile[] {
  const ordered: ItemFile[] = [];
  for (const id of itemIds.slice(0, streamEndOffset)) {
    const item = itemsById.get(id);
    if (item) {
      ordered.push(item);
    }
  }
  return ordered;
}

/**
 * True when the prefetch window is fully materialized (or intentionally empty).
 * Used to avoid committing a partial/wrong slice as the final display set.
 */
export function isDashboardPrefetchWindowReady(
  itemIds: string[],
  itemsById: ReadonlyMap<string, ItemFile>,
  streamEndOffset: number,
): boolean {
  if (itemIds.length === 0) {
    return streamEndOffset === 0;
  }
  if (streamEndOffset <= 0) {
    return false;
  }
  const end = Math.min(streamEndOffset, itemIds.length);
  for (let i = 0; i < end; i++) {
    if (!itemsById.has(itemIds[i]!)) {
      return false;
    }
  }
  return true;
}

export function itemIdsEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length && left.every((id, index) => id === right[index])
  );
}
