/**
 * Resolve absolute thumbnail paths for dashboard/hero (mirrors Rust
 * `resolve_item_thumbnail_paths` in `src-tauri/src/vault_fs.rs`).
 *
 * Cover membership is on disk (#276): `media/<noteUuid>/cover.webp`, then
 * first image in the gallery folder. Frontmatter paths are not the SoT.
 *
 * Issue #255: domain host must not stub this to null.
 */

import type { FileSystemAdapter } from "../adapters/types.js";
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
