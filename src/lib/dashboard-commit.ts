import type {
  DashboardCoverPathEntry,
  DashboardSnapshot,
  ItemFile,
} from "@collector/shared";
import type { DashboardQueryCacheEntry } from "../services/dashboard-query-cache";

export function orderedIds(items: ItemFile[]): string[] {
  return items.map((item) => item.id);
}

export function itemCoverStamp(
  item: Pick<ItemFile, "thumbnail" | "updated_at">,
): string {
  return `${item.thumbnail ?? ""}:${item.updated_at}`;
}

export function coverNeedsResolve(
  item: ItemFile,
  paths: Map<string, string | null>,
  stamps: Map<string, string>,
): boolean {
  if (!paths.has(item.id)) {
    return true;
  }
  return stamps.get(item.id) !== itemCoverStamp(item);
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

function tagIdsKey(tagIds: string[]): string {
  return [...tagIds].sort().join("\0");
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
      a.thumbnail !== b.thumbnail ||
      a.description !== b.description ||
      a.url !== b.url ||
      a.content_type !== b.content_type ||
      tagIdsKey(a.tag_ids) !== tagIdsKey(b.tag_ids)
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

export function mergeCommittedThumbnailStamps(
  prev: Map<string, string>,
  nextStamps: Map<string, string>,
  orderedItemIds: string[],
): Map<string, string> {
  const merged = new Map(prev);
  for (const id of orderedItemIds) {
    if (nextStamps.has(id)) {
      merged.set(id, nextStamps.get(id)!);
    }
  }
  const orderedSet = new Set(orderedItemIds);
  for (const id of [...merged.keys()]) {
    if (!orderedSet.has(id)) {
      merged.delete(id);
    }
  }
  return merged;
}

export function coverPathsFromMaps(
  paths: Map<string, string | null>,
  stamps: Map<string, string>,
): Record<string, DashboardCoverPathEntry> {
  const out: Record<string, DashboardCoverPathEntry> = {};
  for (const [id, path] of paths) {
    const stamp = stamps.get(id);
    if (stamp === undefined) {
      continue;
    }
    out[id] = { path, stamp };
  }
  return out;
}

export function mapsFromCoverPaths(coverPaths: DashboardSnapshot["cover_paths"]): {
  thumbnailPaths: Map<string, string | null>;
  thumbnailStamps: Map<string, string>;
} {
  const thumbnailPaths = new Map<string, string | null>();
  const thumbnailStamps = new Map<string, string>();
  for (const [id, entry] of Object.entries(coverPaths ?? {})) {
    thumbnailPaths.set(id, entry.path);
    thumbnailStamps.set(id, entry.stamp);
  }
  return { thumbnailPaths, thumbnailStamps };
}

export function mapsFromBodyStamps(
  bodyStamps: Record<string, string> | undefined,
): Map<string, string> {
  return new Map(Object.entries(bodyStamps ?? {}));
}

export function bodyStampsFromMap(
  stamps: Map<string, string>,
): Record<string, string> {
  return Object.fromEntries(stamps);
}

export function snapshotToCacheEntry(
  snap: DashboardSnapshot,
): DashboardQueryCacheEntry {
  const { thumbnailPaths, thumbnailStamps } = mapsFromCoverPaths(
    snap.cover_paths,
  );
  return {
    itemIds: [...snap.item_ids],
    itemsById: new Map(snap.items.map((item) => [item.id, item])),
    bodyStamps: mapsFromBodyStamps(snap.body_stamps),
    streamEndOffset: snap.stream_end_offset,
    totalCount: snap.total_count,
    thumbnailPaths,
    thumbnailStamps,
    updatedAt: Date.now(),
  };
}

export function zipIdStamps(
  ids: string[],
  stamps: string[],
): Map<string, string> {
  if (ids.length !== stamps.length) {
    throw new Error(
      `stamps length ${stamps.length} !== ids length ${ids.length}`,
    );
  }
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i++) {
    out.set(ids[i]!, stamps[i]!);
  }
  return out;
}
