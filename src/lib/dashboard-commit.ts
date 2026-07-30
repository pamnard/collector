import type { DashboardSnapshot, ItemFile } from "@collector/shared";
import type { DashboardQueryCacheEntry } from "../services/dashboard-query-cache";

export function orderedIds(items: ItemFile[]): string[] {
  return items.map((item) => item.id);
}

export function thumbnailPathsEqual(
  left: Map<string, string | null>,
  right: Map<string, string | null>,
  ids: string[],
): boolean {
  for (const id of ids) {
    if ((left.get(id) ?? null) !== (right.get(id) ?? null)) {
      return false;
    }
  }
  return true;
}

export function itemsBodiesEqual(left: ItemFile[], right: ItemFile[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i++) {
    const a = left[i]!;
    const b = right[i]!;
    if (
      a.id !== b.id ||
      a.updated_at !== b.updated_at ||
      a.title !== b.title ||
      a.thumbnail !== b.thumbnail
    ) {
      return false;
    }
  }
  return true;
}

/** Aborted/incomplete stream must not blank a held previous paint. */
export function shouldSkipEmptyCommit(
  orderedLen: number,
  prevLen: number,
  nextTotal: number,
): boolean {
  return orderedLen === 0 && prevLen > 0 && nextTotal > 0;
}

export function mergeCommittedThumbnailPaths(
  prev: Map<string, string | null>,
  resolved: Map<string, string | null>,
  orderedItemIds: string[],
): Map<string, string | null> {
  const mergedPaths = new Map(prev);
  for (const id of orderedItemIds) {
    if (resolved.has(id)) {
      mergedPaths.set(id, resolved.get(id) ?? null);
    }
  }
  const orderedSet = new Set(orderedItemIds);
  for (const id of [...mergedPaths.keys()]) {
    if (!orderedSet.has(id)) {
      mergedPaths.delete(id);
    }
  }
  return mergedPaths;
}

export function snapshotToCacheEntry(
  snap: DashboardSnapshot,
): DashboardQueryCacheEntry {
  return {
    itemIds: [...snap.item_ids],
    itemsById: new Map(snap.items.map((item) => [item.id, item])),
    streamEndOffset: snap.stream_end_offset,
    totalCount: snap.total_count,
    thumbnailPaths: new Map(),
    updatedAt: Date.now(),
  };
}
