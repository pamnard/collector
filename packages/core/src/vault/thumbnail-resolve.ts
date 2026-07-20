/**
 * Resolve absolute thumbnail paths for dashboard/hero (mirrors Rust
 * `resolve_item_thumbnail_paths` in `src-tauri/src/vault_fs.rs`).
 *
 * Issue #255: domain host must not stub this to null.
 */

import type { FileSystemAdapter } from "../adapters/types.js";
import { resolveItemThumbnailAbsolutePath } from "./cover-operations.js";
import { listMediaFiles, mediaFilePath } from "./media-io.js";

export interface ThumbnailResolveItem {
  id: string;
  thumbnail: string | null;
}

export interface ThumbnailResolveResult {
  id: string;
  path: string | null;
}

async function resolveOneThumbnail(
  fs: FileSystemAdapter,
  vaultPath: string,
  item: ThumbnailResolveItem,
): Promise<string | null> {
  if (item.thumbnail) {
    const candidate = resolveItemThumbnailAbsolutePath(
      vaultPath,
      item.id,
      item.thumbnail,
    );
    if (candidate && (await fs.exists(candidate))) {
      return candidate;
    }
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

  return null;
}

export async function resolveItemThumbnailPathsBatch(
  fs: FileSystemAdapter,
  vaultPath: string,
  items: ThumbnailResolveItem[],
): Promise<ThumbnailResolveResult[]> {
  if (!items.length) {
    return [];
  }

  const results: ThumbnailResolveResult[] = [];
  for (const item of items) {
    results.push({
      id: item.id,
      path: await resolveOneThumbnail(fs, vaultPath, item),
    });
  }
  return results;
}
