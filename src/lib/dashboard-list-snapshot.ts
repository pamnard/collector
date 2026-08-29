import type { ItemFile } from "@collector/shared";
import {
  coverMapsClear,
  coverMapsClone,
  emptyCoverMaps,
  type CoverMaps,
} from "./cover-maps.ts";

/**
 * Shared dashboard list fields used by live working state and query-cache entries.
 * `bodyStamps` are index presentation stamps (file_mtime_ms) keyed by item id (#623).
 * Cover SoT is opaque {@link CoverMaps} (#874).
 */
export interface DashboardListSnapshot {
  itemIds: string[];
  itemsById: Map<string, ItemFile>;
  bodyStamps: Map<string, string>;
  covers: CoverMaps;
  streamEndOffset: number;
  totalCount: number;
}

export type DashboardListSnapshotPruneInput = {
  itemIds: readonly string[];
  itemsById: ReadonlyMap<string, ItemFile>;
  bodyStamps: ReadonlyMap<string, string>;
  covers: CoverMaps;
  streamEndOffset: number;
  totalCount: number;
};

export type DashboardListSnapshotPruneResult =
  | { removed: false }
  | ({ removed: true } & DashboardListSnapshot);

/**
 * Clone a list snapshot with one item id removed from ids, bodies, and covers.
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

  return {
    removed: true,
    itemIds,
    itemsById,
    bodyStamps,
    covers: coverMapsClear(input.covers, itemId),
    streamEndOffset: Math.min(input.streamEndOffset, itemIds.length),
    totalCount: Math.max(0, input.totalCount - removedFromIds),
  };
}

export { emptyCoverMaps, coverMapsClone };
