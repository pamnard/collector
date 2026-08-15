import type {
  DashboardCoverPathEntry,
  DashboardSnapshot,
  ItemFile,
} from "@collector/shared";
import type { DashboardQueryCacheEntry } from "../services/dashboard-query-cache";
import {
  pruneItemIdFromDashboardListSnapshot,
  type DashboardListSnapshot as DashboardListSharedFields,
  type DashboardListSnapshotPruneInput,
} from "./dashboard-list-snapshot.ts";

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

/**
 * Dashboard masonry reads committed cover maps only (#657).
 * `undefined` = still resolving; `null` = no cover.
 */
export function resolveDashboardGridThumbnailPath(
  item: ItemFile,
  paths: Map<string, string | null>,
  stamps: Map<string, string>,
): string | null | undefined {
  if (!coverNeedsResolve(item, paths, stamps)) {
    return paths.get(item.id) ?? null;
  }
  return undefined;
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
    // Never warm a sticky null (#720): cover may exist on disk without stamp bump.
    // Missing map entry → coverNeedsResolve → fresh host resolve.
    if (entry.path == null) {
      continue;
    }
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

/** Drop one id from an ordered list of `{ id }` rows (search hits, teasers, …). */
export function filterOutItemId<T extends { id: string }>(
  items: readonly T[],
  itemId: string,
): T[] {
  return items.filter((item) => item.id !== itemId);
}

/** Keep committed paint rows whose ids are still in the index page. */
export function intersectCommittedWithPageIds(
  committed: readonly ItemFile[],
  pageItemIds: readonly string[],
): ItemFile[] {
  const allowed = new Set(pageItemIds);
  return committed.filter((item) => allowed.has(item.id));
}

export type DashboardListPruneInput = DashboardListSnapshotPruneInput & {
  committedItems: readonly ItemFile[];
  committedTotalCount: number;
};

/**
 * Full working + committed list window for dashboard paint (#655).
 * Shared list fields are composed from `dashboard-list-snapshot`; applied atomically
 * via {@link applyDashboardListSnapshot} so setters and refs stay aligned.
 */
export type DashboardListSnapshot = DashboardListSharedFields & {
  committedItems: ItemFile[];
  committedTotalCount: number;
};

export type DashboardListPruneResult =
  | { removed: false }
  | ({ removed: true } & DashboardListSnapshot);

/** Imperative writers for one list snapshot (hook mirrors each into state + refs). */
export type DashboardListSnapshotSink = {
  setItemIds: (ids: string[]) => void;
  setItemsById: (byId: Map<string, ItemFile>) => void;
  setBodyStamps: (stamps: Map<string, string>) => void;
  setStreamEndOffset: (end: number) => void;
  setTotalCount: (total: number) => void;
  setCommittedItems: (items: ItemFile[]) => void;
  setCommittedTotalCount: (total: number) => void;
  setCommittedHasMore: (hasMore: boolean) => void;
  setCommittedThumbnailPaths: (paths: Map<string, string | null>) => void;
  setCommittedThumbnailStamps: (stamps: Map<string, string>) => void;
};

/**
 * Push one list snapshot through every working + committed writer.
 * `hasMore` is derived from stream end vs committed total (display window).
 */
export function applyDashboardListSnapshot(
  snapshot: DashboardListSnapshot,
  sink: DashboardListSnapshotSink,
): void {
  sink.setItemIds(snapshot.itemIds);
  sink.setItemsById(snapshot.itemsById);
  sink.setBodyStamps(snapshot.bodyStamps);
  sink.setStreamEndOffset(snapshot.streamEndOffset);
  sink.setTotalCount(snapshot.totalCount);
  sink.setCommittedItems(snapshot.committedItems);
  sink.setCommittedTotalCount(snapshot.committedTotalCount);
  sink.setCommittedHasMore(
    snapshot.streamEndOffset < snapshot.committedTotalCount,
  );
  sink.setCommittedThumbnailPaths(snapshot.thumbnailPaths);
  sink.setCommittedThumbnailStamps(snapshot.thumbnailStamps);
}

/**
 * Synchronously remove one item id from dashboard working + committed lists.
 * Idempotent when the id is already absent.
 */
export function pruneItemIdFromDashboardLists(
  itemId: string,
  input: DashboardListPruneInput,
): DashboardListPruneResult {
  const list = pruneItemIdFromDashboardListSnapshot(itemId, input);
  const committedItems = filterOutItemId(input.committedItems, itemId);
  const removedFromCommitted =
    input.committedItems.length - committedItems.length;

  if (!list.removed && removedFromCommitted === 0) {
    return { removed: false };
  }

  if (list.removed) {
    const removedFromIds = input.itemIds.length - list.itemIds.length;
    return {
      removed: true,
      itemIds: list.itemIds,
      itemsById: list.itemsById,
      bodyStamps: list.bodyStamps,
      thumbnailPaths: list.thumbnailPaths,
      thumbnailStamps: list.thumbnailStamps,
      streamEndOffset: list.streamEndOffset,
      totalCount: list.totalCount,
      committedItems,
      committedTotalCount: Math.max(
        0,
        input.committedTotalCount -
          Math.max(removedFromIds, removedFromCommitted),
      ),
    };
  }

  // Present only in committed paint — clone snapshot fields and drop orphan keys
  // (stamps/paths may still hold the id even when itemIds/itemsById do not).
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
    itemIds: [...input.itemIds],
    itemsById,
    bodyStamps,
    thumbnailPaths,
    thumbnailStamps,
    streamEndOffset: Math.min(input.streamEndOffset, input.itemIds.length),
    totalCount: input.totalCount,
    committedItems,
    committedTotalCount: Math.max(
      0,
      input.committedTotalCount - removedFromCommitted,
    ),
  };
}
