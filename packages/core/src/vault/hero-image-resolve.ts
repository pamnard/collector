/**
 * Detail hero media: which gallery/cover file is chosen, and its kind.
 *
 * Cover identity SoT matches the dashboard (#276): when `cover.webp` exists it
 * is the chosen preview — do not re-scan the gallery to pick “which” image
 * (f00fe67 / gallery-first mismatch).
 *
 * Display sharpness (#741 / #879): `<img>` / `/media/derive` use the full gallery
 * file recorded in `cover.source.json` (same media that built cover.webp).
 * Teaser layout sizes still come from cover.webp + `cover.size.json`.
 * Without a source sidecar (legacy), falls back to cover.webp.
 *
 * Video-only keeps Play on the gallery video with cover.webp as poster.
 * Play affordance follows kind === "video", not item content_type.
 */

import type { FileSystemAdapter } from "../adapters/types.js";
import { inferMediaType } from "@collector/shared";
import { readItemCoverSource } from "./cover-operations.js";
import {
  findFirstGalleryImagePath,
  findFirstGalleryVideoPath,
  findGalleryImagePathByMediaId,
  findSoleGalleryImagePath,
  mediaFilePath,
} from "./media-io.js";
import { itemCoverPath } from "./paths.js";

export type ItemHeroMediaKind = "image" | "video";

export interface ItemHeroMedia {
  kind: ItemHeroMediaKind;
  /** Chosen file (gallery image, gallery video, or cover.webp). */
  filePath: string;
  /**
   * Path for `<img>`: full cover-source media when known, else cover/gallery,
   * or cover.webp poster when kind is video. Null when video and no cover yet.
   */
  displayPath: string | null;
}

/**
 * Absolute path of the gallery image that built `cover.webp`, when known.
 * Null when no usable source (callers fall back to cover.webp).
 *
 * Hot path (#879): no `listMediaFiles` / per-file `stat`. Prefers O(1) when
 * `cover.source.json` carries `filename`; otherwise one `readDirEntries`.
 */
export async function resolveCoverSourceDisplayPath(
  fs: FileSystemAdapter,
  vaultPath: string,
  itemId: string,
): Promise<string | null> {
  const source = await readItemCoverSource(fs, vaultPath, itemId);

  if (source?.filename && inferMediaType(source.filename) === "image") {
    const absolute = mediaFilePath(
      vaultPath,
      itemId,
      source.mediaId,
      source.filename,
    );
    if (await fs.exists(absolute)) {
      return absolute;
    }
  }

  if (source) {
    const byId = await findGalleryImagePathByMediaId(
      fs,
      vaultPath,
      itemId,
      source.mediaId,
    );
    if (byId !== null) {
      return byId;
    }
  }

  // Legacy covers (no cover.source.json / stale id): sole gallery image only.
  return findSoleGalleryImagePath(fs, vaultPath, itemId);
}

export async function resolveItemHeroMedia(
  fs: FileSystemAdapter,
  vaultPath: string,
  itemId: string,
): Promise<ItemHeroMedia | null> {
  const cover = itemCoverPath(vaultPath, itemId);
  const hasCover = await fs.exists(cover);
  const galleryImage = await findFirstGalleryImagePath(fs, vaultPath, itemId);
  const galleryVideo = await findFirstGalleryVideoPath(fs, vaultPath, itemId);

  if (hasCover) {
    // Same chosen preview as the grid. Video-only keeps Play + cover poster.
    if (galleryImage === null && galleryVideo !== null) {
      return {
        kind: "video",
        filePath: galleryVideo,
        displayPath: cover,
      };
    }
    const fullSource = await resolveCoverSourceDisplayPath(fs, vaultPath, itemId);
    return {
      kind: "image",
      filePath: cover,
      displayPath: fullSource ?? cover,
    };
  }

  if (galleryImage !== null) {
    return {
      kind: "image",
      filePath: galleryImage,
      displayPath: galleryImage,
    };
  }

  if (galleryVideo !== null) {
    return {
      kind: "video",
      filePath: galleryVideo,
      displayPath: null,
    };
  }

  return null;
}
