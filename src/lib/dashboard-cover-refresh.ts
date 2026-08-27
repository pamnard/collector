/**
 * Per-item cover refresh sequencing for dashboard coverPatch (#856).
 * Newer refresh generations win; stale onResolved must not overwrite.
 */

export function bumpCoverRefreshGeneration(
  generations: Map<string, number>,
  itemId: string,
): number {
  const next = (generations.get(itemId) ?? 0) + 1;
  generations.set(itemId, next);
  return next;
}

export function isCoverRefreshGenerationCurrent(
  generations: ReadonlyMap<string, number>,
  itemId: string,
  generation: number,
): boolean {
  return generations.get(itemId) === generation;
}

export function notePendingCoverRefresh(
  pending: Set<string>,
  itemId: string,
): void {
  pending.add(itemId);
}

/** Drain pending ids that are now present in the dashboard item set. */
export function takePendingCoverRefreshesForItems(
  pending: Set<string>,
  presentItemIds: Iterable<string>,
): string[] {
  const ready: string[] = [];
  for (const id of presentItemIds) {
    if (!pending.has(id)) {
      continue;
    }
    pending.delete(id);
    ready.push(id);
  }
  return ready;
}
