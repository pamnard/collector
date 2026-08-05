/**
 * Resolve absolute thumbnail paths for dashboard/hero (mirrors Rust
 * `resolve_item_thumbnail_paths` in `src-tauri/src/vault_fs.rs`).
 *
 * Cover membership is on disk (#276): `media/<noteUuid>/cover.webp`, then
 * first image in the gallery folder. Frontmatter paths are not the SoT.
 *
 * Issue #255: domain host must not stub this to null.
 * Issue #544: progressive emit + bounded parallel resolve.
 */

import type { FileSystemAdapter } from "../adapters/types.js";
import { DISK_ITEM_READ_CONCURRENCY } from "../util/concurrency.js";
import { listMediaFiles, mediaFilePath } from "./media-io.js";
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

  const media = await listMediaFiles(fs, vaultPath, item.id);
  for (const file of media) {
    if (file.media_type !== "image") {
      continue;
    }
    const candidate = mediaFilePath(
      vaultPath,
      item.id,
      file.id,
      file.filename,
    );
    if (await fs.exists(candidate)) {
      return candidate;
    }
  }

  // Remote URL only — not a vault file path (#276: no FM attachment addresses).
  if (
    item.thumbnail &&
    (item.thumbnail.startsWith("http://") ||
      item.thumbnail.startsWith("https://"))
  ) {
    return item.thumbnail;
  }

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
