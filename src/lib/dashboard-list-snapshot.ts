import type { ItemFile } from "@collector/shared";

/**
 * Shared dashboard list fields used by live working state and query-cache entries.
 * `bodyStamps` are index presentation stamps (file_mtime_ms) keyed by item id (#623).
 * Keep field surgery for prune in one place so these stay in sync.
 */
export interface DashboardListSnapshot {
  itemIds: string[];
  itemsById: Map<string, ItemFile>;
  bodyStamps: Map<string, string>;
  thumbnailPaths: Map<string, string | null>;
  thumbnailStamps: Map<string, string>;
  streamEndOffset: number;
  totalCount: number;
}

export type DashboardListSnapshotPruneInput = {
  itemIds: readonly string[];
  itemsById: ReadonlyMap<string, ItemFile>;
  bodyStamps: ReadonlyMap<string, string>;
  thumbnailPaths: ReadonlyMap<string, string | null>;
  thumbnailStamps: ReadonlyMap<string, string>;
  streamEndOffset: number;
  totalCount: number;
};

export type DashboardListSnapshotPruneResult =
  | { removed: false }
  | ({ removed: true } & DashboardListSnapshot);

/**
 * Clone a list snapshot with one item id removed from ids, bodies, and stamps.
 * Idempotent when the id is already absent from `itemIds` and `itemsById`.
 */
export function pruneItemIdFromDashboardListSnapshot(
  itemId: string,
  input: DashboardListSnapshotPruneInput,
): DashboardListSnapshotPruneResult {
  if (!input.itemIds.includes(itemId) && !input.itemsById.has(itemId)) {
    return { removed: false };
  }

  const itemIds = input.itemIds.filter((id) => id !== itemId);
  const removedFromIds = input.itemIds.length - itemIds.length;
  const itemsById = new Map(input.itemsById);
  itemsById.delete(itemId);
  const bodyStamps = new Map(input.bodyStamps);
  bodyStamps.delete(itemId);
  const thumbnailPaths = new Map(input.thumbnailPaths);
  thumbnailPaths.delete(itemId);
  const thumbnailStamps = new Map(input.thumbnailStamps);
  thumbnailStamps.delete(itemId);

  return {
    removed: true,
    itemIds,
    itemsById,
    bodyStamps,
    thumbnailPaths,
    thumbnailStamps,
    streamEndOffset: Math.min(input.streamEndOffset, itemIds.length),
    totalCount: Math.max(0, input.totalCount - removedFromIds),
  };
}
