import type {
  DashboardCoverPathEntry,
  DashboardSnapshot,
  ItemFile,
} from "@collector/shared";
import {
  positiveThumbnailPixelSize,
  type ItemThumbnailPixelSize,
} from "@collector/api";
import type { DashboardQueryCacheEntry } from "../services/dashboard-query-cache";
import { itemIdsEqual } from "./dashboard-display.ts";
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
  sizes?: Map<string, ItemThumbnailPixelSize | null>,
): boolean {
  if (!paths.has(item.id)) {
    return true;
  }
  if (stamps.get(item.id) !== itemCoverStamp(item)) {
    return true;
  }
  // Path without pixel size → re-resolve so the grid can reserve exact aspect.
  if (sizes && !sizes.has(item.id)) {
    return true;
  }
  return false;
}

/**
 * Dashboard masonry reads committed cover maps only (#657).
 * `undefined` = still resolving; `null` = no cover.
 */
export function resolveDashboardGridThumbnail(
  item: ItemFile,
  paths: Map<string, string | null>,
  stamps: Map<string, string>,
  sizes: Map<string, ItemThumbnailPixelSize | null>,
): {
  path: string | null | undefined;
  size: ItemThumbnailPixelSize | null | undefined;
} {
  if (coverNeedsResolve(item, paths, stamps, sizes)) {
    return { path: undefined, size: undefined };
  }
  return {
    path: paths.get(item.id) ?? null,
    size: sizes.get(item.id) ?? null,
  };
}

export function resolveDashboardGridThumbnailPath(
  item: ItemFile,
  paths: Map<string, string | null>,
  stamps: Map<string, string>,
  sizes?: Map<string, ItemThumbnailPixelSize | null>,
): string | null | undefined {
  if (sizes !== undefined) {
    return resolveDashboardGridThumbnail(item, paths, stamps, sizes).path;
  }
  if (!coverNeedsResolve(item, paths, stamps)) {
    return paths.get(item.id) ?? null;
  }
  return undefined;
}

/** Pixel size when path is resolved; undefined while still resolving. */
export function resolveDashboardGridThumbnailSize(
  item: ItemFile,
  paths: Map<string, string | null>,
  stamps: Map<string, string>,
  sizes: Map<string, ItemThumbnailPixelSize | null>,
): ItemThumbnailPixelSize | null | undefined {
  return resolveDashboardGridThumbnail(item, paths, stamps, sizes).size;
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

export function thumbnailPixelSizesEqual(
  left: ItemThumbnailPixelSize | null | undefined,
  right: ItemThumbnailPixelSize | null | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (left == null || right == null) {
    return left === right;
  }
  return left.width === right.width && left.height === right.height;
}

export function thumbnailSizesEqual(
  left: Map<string, ItemThumbnailPixelSize | null>,
  right: Map<string, ItemThumbnailPixelSize | null>,
  ids: string[],
): boolean {
  for (const id of ids) {
    if (
      !thumbnailPixelSizesEqual(left.get(id) ?? null, right.get(id) ?? null)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Order-independent tag multiset equality without sorting a fresh copy (#788).
 * Same-reference / same-order paths avoid Map allocation on the commit hot path.
 */
function tagIdsMultisetEqual(left: string[], right: string[]): boolean {
  const counts = new Map<string, number>();
  for (const id of left) {
    const n = counts.get(id);
    counts.set(id, n === undefined ? 1 : n + 1);
  }
  for (const id of right) {
    const n = counts.get(id);
    if (n === undefined) {
      return false;
    }
    if (n === 1) {
      counts.delete(id);
    } else {
      counts.set(id, n - 1);
    }
  }
  return counts.size === 0;
}

function tagIdsEqualUnordered(left: string[], right: string[]): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) {
      return tagIdsMultisetEqual(left, right);
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
      a.thumbnail !== b.thumbnail ||
      a.description !== b.description ||
      a.url !== b.url ||
      a.content_type !== b.content_type ||
      !tagIdsEqualUnordered(a.tag_ids, b.tag_ids)
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

export type ShouldSkipCommitPaintInput = {
  prevOrderedIds: readonly string[];
  nextOrderedIds: readonly string[];
  prevTotalCount: number;
  nextTotalCount: number;
  prevBodyStamps: ReadonlyMap<string, string>;
  nextBodyStamps: ReadonlyMap<string, string>;
};

/**
 * Stamp+id short-circuit for dashboard commit paint (#664).
 * When ordered ids, totalCount, and body stamps for those ids are unchanged,
 * callers may skip setCommittedItems, itemsBodiesEqual, and cover flight when
 * covers are already valid. Missing stamps fail closed (do not skip).
 */
export function shouldSkipCommitPaint(
  input: ShouldSkipCommitPaintInput,
): boolean {
  const {
    prevOrderedIds,
    nextOrderedIds,
    prevTotalCount,
    nextTotalCount,
    prevBodyStamps,
    nextBodyStamps,
  } = input;

  if (prevTotalCount !== nextTotalCount) {
    return false;
  }
  if (!itemIdsEqual(prevOrderedIds, nextOrderedIds)) {
    return false;
  }
  for (const id of nextOrderedIds) {
    const prevStamp = prevBodyStamps.get(id);
    const nextStamp = nextBodyStamps.get(id);
    if (prevStamp === undefined || nextStamp === undefined) {
      return false;
    }
    if (prevStamp !== nextStamp) {
      return false;
    }
  }
  return true;
}

/** Snapshot body stamps for an ordered id window (omit ids without stamps). */
export function bodyStampsForOrderedIds(
  stamps: ReadonlyMap<string, string>,
  orderedIds: readonly string[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of orderedIds) {
    const stamp = stamps.get(id);
    if (stamp !== undefined) {
      out.set(id, stamp);
    }
  }
  return out;
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

export function mergeCommittedThumbnailSizes(
  prev: Map<string, ItemThumbnailPixelSize | null>,
  resolved: Map<string, ItemThumbnailPixelSize | null>,
  orderedItemIds: string[],
): Map<string, ItemThumbnailPixelSize | null> {
  const merged = new Map(prev);
  for (const id of orderedItemIds) {
    if (resolved.has(id)) {
      merged.set(id, resolved.get(id) ?? null);
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
  sizes?: Map<string, ItemThumbnailPixelSize | null>,
): Record<string, DashboardCoverPathEntry> {
  const out: Record<string, DashboardCoverPathEntry> = {};
  for (const [id, path] of paths) {
    const stamp = stamps.get(id);
    if (stamp === undefined) {
      continue;
    }
    const size = sizes?.get(id) ?? null;
    out[id] = {
      path,
      stamp,
      width: size?.width ?? null,
      height: size?.height ?? null,
    };
  }
  return out;
}

export function mapsFromCoverPaths(coverPaths: DashboardSnapshot["cover_paths"]): {
  thumbnailPaths: Map<string, string | null>;
  thumbnailStamps: Map<string, string>;
  thumbnailSizes: Map<string, ItemThumbnailPixelSize | null>;
} {
  const thumbnailPaths = new Map<string, string | null>();
  const thumbnailStamps = new Map<string, string>();
  const thumbnailSizes = new Map<string, ItemThumbnailPixelSize | null>();
  for (const [id, entry] of Object.entries(coverPaths ?? {})) {
    // Never warm a sticky null (#720): cover may exist on disk without stamp bump.
    // Missing map entry → coverNeedsResolve → fresh host resolve.
    if (entry.path == null) {
      continue;
    }
    thumbnailPaths.set(id, entry.path);
    thumbnailStamps.set(id, entry.stamp);
    const size = positiveThumbnailPixelSize(entry.width, entry.height);
    if (size) {
      thumbnailSizes.set(id, size);
    }
  }
  return { thumbnailPaths, thumbnailStamps, thumbnailSizes };
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
  const { thumbnailPaths, thumbnailStamps, thumbnailSizes } = mapsFromCoverPaths(
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
    thumbnailSizes,
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

/**
 * Like {@link intersectCommittedWithPageIds}, but returns `null` when zero
 * overlap would clear committed paint — hold previous folder cards until commit
 * (#779).
 */
export function intersectCommittedWithPageIdsHoldPaint(
  committed: readonly ItemFile[],
  pageItemIds: readonly string[],
): ItemFile[] | null {
  if (!pageItemIds.length) {
    return intersectCommittedWithPageIds(committed, pageItemIds);
  }
  const next = intersectCommittedWithPageIds(committed, pageItemIds);
  if (committed.length > 0 && next.length === 0) {
    return null;
  }
  return next;
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
  setCommittedThumbnailSizes: (
    sizes: Map<string, ItemThumbnailPixelSize | null>,
  ) => void;
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
  sink.setCommittedThumbnailSizes(snapshot.thumbnailSizes);
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
      thumbnailSizes: list.thumbnailSizes,
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
  const thumbnailSizes = new Map(input.thumbnailSizes);
  thumbnailSizes.delete(itemId);
  return {
    removed: true,
    itemIds: [...input.itemIds],
    itemsById,
    bodyStamps,
    thumbnailPaths,
    thumbnailStamps,
    thumbnailSizes,
    streamEndOffset: Math.min(input.streamEndOffset, input.itemIds.length),
    totalCount: input.totalCount,
    committedItems,
    committedTotalCount: Math.max(
      0,
      input.committedTotalCount - removedFromCommitted,
    ),
  };
}
