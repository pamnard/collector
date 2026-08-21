/**
 * Resolve absolute thumbnail paths for dashboard/hero (mirrors Rust
 * host thumbnail resolve / cover paths).
 *
 * Cover membership is on disk (#276): `media/<noteUuid>/cover.webp`, then
 * gallery image. Frontmatter paths are not the SoT. Remote http(s) is never
 * a display source (#739) — localize at ingest/save instead.
 *
 * Issue #255: domain host must not stub this to null.
 * Issue #544: progressive emit + bounded parallel resolve.
 * Issue #711: gallery fallback without O(g) exists probes.
 *   “First” gallery image = lexicographic min of image entry names
 *   (not readdir order, not `listMediaFiles` created_at/mtime order).
 */

import type { FileSystemAdapter } from "../adapters/types.js";
import { DISK_ITEM_READ_CONCURRENCY } from "../util/concurrency.js";
import { findFirstGalleryImagePath } from "./media-io.js";
import { itemCoverPath } from "./paths.js";

export interface ThumbnailResolveItem {
  id: string;
  thumbnail: string | null;
}

export interface ThumbnailResolveResult {
  id: string;
  path: string | null;
}

export interface ResolveItemThumbnailPathsProgressiveOptions {
  /** Default: {@link DISK_ITEM_READ_CONCURRENCY}. */
  concurrency?: number;
  onResolved: (result: ThumbnailResolveResult) => void;
  signal?: AbortSignal;
}

async function resolveOneThumbnail(
  fs: FileSystemAdapter,
  vaultPath: string,
  item: ThumbnailResolveItem,
): Promise<string | null> {
  const cover = itemCoverPath(vaultPath, item.id);
  if (await fs.exists(cover)) {
    return cover;
  }

  // Gallery “first” = lex-min image entry name (#711); see findFirstGalleryImagePath.
  const galleryImage = await findFirstGalleryImagePath(fs, vaultPath, item.id);
  if (galleryImage !== null) {
    return galleryImage;
  }

  // Remote http(s) thumbnails are not display assets (#739). Cover/gallery on
  // disk only; FM `thumbnail` URLs must be localized at ingest/save.
  return null;
}

/**
 * Resolve thumbnail paths with a bounded worker pool; emit each id as soon as
 * it is ready (#544).
 */
export async function resolveItemThumbnailPathsProgressive(
  fs: FileSystemAdapter,
  vaultPath: string,
  items: ThumbnailResolveItem[],
  options: ResolveItemThumbnailPathsProgressiveOptions,
): Promise<void> {
  if (!items.length) {
    return;
  }

  const { onResolved, signal } = options;
  const concurrency = options.concurrency ?? DISK_ITEM_READ_CONCURRENCY;
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      if (signal?.aborted) {
        return;
      }

      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }

      const item = items[index]!;
      const path = await resolveOneThumbnail(fs, vaultPath, item);
      if (signal?.aborted) {
        return;
      }

      onResolved({ id: item.id, path });
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

export async function resolveItemThumbnailPathsBatch(
  fs: FileSystemAdapter,
  vaultPath: string,
  items: ThumbnailResolveItem[],
): Promise<ThumbnailResolveResult[]> {
  if (!items.length) {
    return [];
  }

  const byId = new Map<string, string | null>();
  await resolveItemThumbnailPathsProgressive(fs, vaultPath, items, {
    onResolved: (result) => {
      byId.set(result.id, result.path);
    },
  });

  return items.map((item) => ({
    id: item.id,
    path: byId.get(item.id) ?? null,
  }));
}
