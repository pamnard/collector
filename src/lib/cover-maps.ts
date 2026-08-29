/**
 * Opaque cover-map triple for dashboard masonry (#874).
 * Callers use ops; do not assemble three Maps for routine work.
 */

import type {
  DashboardCoverPathEntry,
  DashboardSnapshot,
  ItemFile,
} from "@collector/shared";
import {
  positiveThumbnailPixelSize,
  type ItemThumbnailPixelSize,
} from "@collector/api";

export type CoverMaps = {
  readonly paths: Map<string, string | null>;
  readonly stamps: Map<string, string>;
  readonly sizes: Map<string, ItemThumbnailPixelSize | null>;
};

export type CoverMapsGridResolve = {
  path: string | null | undefined;
  size: ItemThumbnailPixelSize | null | undefined;
};

export type CoverMapsPatch = {
  paths: Map<string, string | null>;
  stamps: Map<string, string>;
  sizes: Map<string, ItemThumbnailPixelSize | null>;
};

export function emptyCoverMaps(): CoverMaps {
  return {
    paths: new Map(),
    stamps: new Map(),
    sizes: new Map(),
  };
}

/** Defensive copy — React/UI must not share Map identity with live SoT. */
export function coverMapsClone(maps: CoverMaps): CoverMaps {
  return {
    paths: new Map(maps.paths),
    stamps: new Map(maps.stamps),
    sizes: new Map(maps.sizes),
  };
}

/** Adapter/tests: wrap an existing triple without copying. */
export function coverMapsFromTriple(
  paths: Map<string, string | null>,
  stamps: Map<string, string>,
  sizes: Map<string, ItemThumbnailPixelSize | null>,
): CoverMaps {
  return { paths, stamps, sizes };
}

export function orderedIds(items: ItemFile[]): string[] {
  return items.map((item) => item.id);
}

export function itemCoverStamp(
  item: Pick<ItemFile, "thumbnail" | "updated_at">,
): string {
  return `${item.thumbnail ?? ""}:${item.updated_at}`;
}

function coverMapsPositiveSize(
  maps: CoverMaps,
  itemId: string,
): ItemThumbnailPixelSize | null {
  const size = maps.sizes.get(itemId);
  if (size == null) {
    return null;
  }
  return positiveThumbnailPixelSize(size.width, size.height);
}

export function coverMapsNeedsResolve(
  maps: CoverMaps,
  item: ItemFile,
): boolean {
  if (!maps.paths.has(item.id)) {
    return true;
  }
  if (maps.stamps.get(item.id) !== itemCoverStamp(item)) {
    return true;
  }
  // Path without pixel size → re-resolve so the grid can reserve exact aspect.
  // `sizes.set(id, null)` still `.has(id)` — treat null / non-positive as unresolved
  // when a real cover path is present (otherwise cards decode 1×1 then jump).
  if (!maps.sizes.has(item.id)) {
    return true;
  }
  const path = maps.paths.get(item.id);
  if (path != null && coverMapsPositiveSize(maps, item.id) == null) {
    return true;
  }
  return false;
}

/**
 * Dashboard masonry reads committed cover maps only (#657).
 * `undefined` = still resolving; `null` = no cover.
 *
 * Stale-while-revalidate (#871): if maps already hold a real cover path **and**
 * reserved WxH but the stamp is stale, keep showing that path+size while a
 * flight re-resolves. Never expose a cover path without positive WxH — that is
 * the #855 / live CLS jump (1×1 decode → aspect later).
 */
export function coverMapsResolveForGrid(
  maps: CoverMaps,
  item: ItemFile,
): CoverMapsGridResolve {
  if (coverMapsNeedsResolve(maps, item)) {
    const existing = maps.paths.get(item.id);
    const size = coverMapsPositiveSize(maps, item.id);
    // SWR paint only when both path and reserved size exist (no layout jump).
    if (existing != null && size != null) {
      return { path: existing, size };
    }
    return { path: undefined, size: undefined };
  }
  return {
    path: maps.paths.get(item.id) ?? null,
    size: maps.sizes.get(item.id) ?? null,
  };
}

export function coverMapsPathsEqual(
  left: CoverMaps,
  right: CoverMaps,
  ids: string[],
): boolean {
  for (const id of ids) {
    if ((left.paths.get(id) ?? null) !== (right.paths.get(id) ?? null)) {
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

export function coverMapsStampsEqual(
  left: CoverMaps,
  right: CoverMaps,
  ids: string[],
): boolean {
  for (const id of ids) {
    if (left.stamps.get(id) !== right.stamps.get(id)) {
      return false;
    }
  }
  return true;
}

export function coverMapsSizesEqual(
  left: CoverMaps,
  right: CoverMaps,
  ids: string[],
): boolean {
  for (const id of ids) {
    if (
      !thumbnailPixelSizesEqual(
        left.sizes.get(id) ?? null,
        right.sizes.get(id) ?? null,
      )
    ) {
      return false;
    }
  }
  return true;
}

export function coverMapsEqual(
  left: CoverMaps,
  right: CoverMaps,
  ids: string[],
): boolean {
  return (
    coverMapsPathsEqual(left, right, ids) &&
    coverMapsStampsEqual(left, right, ids) &&
    coverMapsSizesEqual(left, right, ids)
  );
}

/**
 * Merge patch into maps for the ordered window. Never downgrades path→null (#871).
 * Skip is atomic: if path→null is refused, stamp/size for that id are not applied.
 * Ids outside orderedItemIds are dropped (intersect).
 */
export function coverMapsMerge(
  maps: CoverMaps,
  patch: CoverMapsPatch,
  orderedItemIds: string[],
): CoverMaps {
  const orderedSet = new Set(orderedItemIds);
  const mergedPaths = new Map(maps.paths);
  const skippedIds = new Set<string>();
  for (const id of orderedItemIds) {
    if (!patch.paths.has(id)) {
      continue;
    }
    const next = patch.paths.get(id) ?? null;
    const previous = mergedPaths.get(id);
    if (next === null && previous != null) {
      skippedIds.add(id);
      continue;
    }
    mergedPaths.set(id, next);
  }

  const mergedStamps = new Map(maps.stamps);
  for (const id of orderedItemIds) {
    if (skippedIds.has(id) || !patch.stamps.has(id)) {
      continue;
    }
    const stamp = patch.stamps.get(id);
    if (stamp === undefined) {
      continue;
    }
    mergedStamps.set(id, stamp);
  }

  const mergedSizes = new Map(maps.sizes);
  for (const id of orderedItemIds) {
    if (skippedIds.has(id) || !patch.sizes.has(id)) {
      continue;
    }
    mergedSizes.set(id, patch.sizes.get(id) ?? null);
  }

  for (const id of mergedPaths.keys()) {
    if (!orderedSet.has(id)) {
      mergedPaths.delete(id);
    }
  }
  for (const id of mergedStamps.keys()) {
    if (!orderedSet.has(id)) {
      mergedStamps.delete(id);
    }
  }
  for (const id of mergedSizes.keys()) {
    if (!orderedSet.has(id)) {
      mergedSizes.delete(id);
    }
  }

  return {
    paths: mergedPaths,
    stamps: mergedStamps,
    sizes: mergedSizes,
  };
}

/** Intersect maps with ordered ids (drop keys outside the window). */
export function coverMapsIntersect(
  maps: CoverMaps,
  orderedItemIds: string[],
): CoverMaps {
  const paths = new Map<string, string | null>();
  const stamps = new Map<string, string>();
  const sizes = new Map<string, ItemThumbnailPixelSize | null>();
  for (const id of orderedItemIds) {
    if (maps.paths.has(id)) {
      paths.set(id, maps.paths.get(id) ?? null);
    }
    const stamp = maps.stamps.get(id);
    if (stamp !== undefined) {
      stamps.set(id, stamp);
    }
    if (maps.sizes.has(id)) {
      sizes.set(id, maps.sizes.get(id) ?? null);
    }
  }
  return { paths, stamps, sizes };
}

/** Drop one id so needsResolve fails open (#871). */
export function coverMapsClear(maps: CoverMaps, itemId: string): CoverMaps {
  const paths = new Map(maps.paths);
  const stamps = new Map(maps.stamps);
  const sizes = new Map(maps.sizes);
  paths.delete(itemId);
  stamps.delete(itemId);
  sizes.delete(itemId);
  return { paths, stamps, sizes };
}

/**
 * Strip sticky-null entries for ordered items so flight can re-resolve (#871).
 * Does not clear positive paths.
 */
export function coverMapsStripStickyNulls(
  maps: CoverMaps,
  orderedItems: ItemFile[],
): { maps: CoverMaps; stripped: boolean } {
  const paths = new Map(maps.paths);
  const stamps = new Map(maps.stamps);
  const sizes = new Map(maps.sizes);
  let stripped = false;
  for (const item of orderedItems) {
    if (paths.get(item.id) !== null) {
      continue;
    }
    if (!paths.has(item.id)) {
      continue;
    }
    paths.delete(item.id);
    stamps.delete(item.id);
    sizes.delete(item.id);
    stripped = true;
  }
  if (!stripped) {
    return { maps, stripped: false };
  }
  return { maps: { paths, stamps, sizes }, stripped: true };
}

/** Omit null paths before cache/snapshot persist (#720 / #871). */
export function coverMapsForPersistence(maps: CoverMaps): CoverMaps {
  return coverMapsPersistenceViews(maps).maps;
}

/** Snapshot record + filtered maps from one omit-null pass. */
export function coverMapsPersistenceViews(maps: CoverMaps): {
  maps: CoverMaps;
  record: Record<string, DashboardCoverPathEntry>;
} {
  const paths = new Map<string, string | null>();
  const stamps = new Map<string, string>();
  const sizes = new Map<string, ItemThumbnailPixelSize | null>();
  const record: Record<string, DashboardCoverPathEntry> = {};
  for (const [id, path] of maps.paths) {
    if (path == null) {
      continue;
    }
    const stamp = maps.stamps.get(id);
    if (stamp === undefined) {
      continue;
    }
    paths.set(id, path);
    stamps.set(id, stamp);
    const size = maps.sizes.get(id);
    if (size !== undefined) {
      sizes.set(id, size);
    }
    const pixel = size ?? null;
    record[id] = {
      path,
      stamp,
      width: pixel?.width ?? null,
      height: pixel?.height ?? null,
    };
  }
  return { maps: { paths, stamps, sizes }, record };
}

export function coverMapsToPersistenceRecord(
  maps: CoverMaps,
): Record<string, DashboardCoverPathEntry> {
  return coverMapsPersistenceViews(maps).record;
}

/** Hydrate from snapshot cover_paths; never warm sticky null (#720). */
export function coverMapsHydrate(
  coverPaths: DashboardSnapshot["cover_paths"],
): CoverMaps {
  const paths = new Map<string, string | null>();
  const stamps = new Map<string, string>();
  const sizes = new Map<string, ItemThumbnailPixelSize | null>();
  for (const [id, entry] of Object.entries(coverPaths ?? {})) {
    if (entry.path == null) {
      continue;
    }
    paths.set(id, entry.path);
    stamps.set(id, entry.stamp);
    const size = positiveThumbnailPixelSize(entry.width, entry.height);
    if (size) {
      sizes.set(id, size);
    }
  }
  return { paths, stamps, sizes };
}

/** Install/upgrade one path (refresh); never writes null. */
export function coverMapsUpsertPath(
  maps: CoverMaps,
  itemId: string,
  path: string,
  stamp: string,
  size: ItemThumbnailPixelSize | null,
): CoverMaps {
  const paths = new Map(maps.paths);
  const stamps = new Map(maps.stamps);
  const sizes = new Map(maps.sizes);
  paths.set(itemId, path);
  stamps.set(itemId, stamp);
  sizes.set(itemId, size);
  return { paths, stamps, sizes };
}
