/**
 * Detail hero media: which gallery/cover file is chosen, and its kind.
 *
 * Cover identity SoT matches the dashboard (#276): when `cover.webp` exists it
 * is the chosen preview — do not re-scan the gallery to pick “which” image
 * (f00fe67 / gallery-first mismatch).
 *
 * Display sharpness (#741): `<img>` uses the full gallery file recorded in
 * `cover.source.json` (same media that built cover.webp). Grid keeps cover.webp.
 * Without a source sidecar (legacy), falls back to cover.webp.
 *
 * Video-only keeps Play on the gallery video with cover.webp as poster.
 * Play affordance follows kind === "video", not item content_type.
 */

import type { FileSystemAdapter } from "../adapters/types.js";
import { readItemCoverSource } from "./cover-operations.js";
import {
  findFirstGalleryImagePath,
  findFirstGalleryVideoPath,
  listMediaFiles,
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

async function resolveCoverSourceDisplayPath(
  fs: FileSystemAdapter,
  vaultPath: string,
  itemId: string,
): Promise<string | null> {
  const source = await readItemCoverSource(fs, vaultPath, itemId);
  const files = await listMediaFiles(fs, vaultPath, itemId);
  const images = files.filter((entry) => entry.media_type === "image");

  if (source) {
    const file = files.find((entry) => entry.id === source.mediaId);
    if (file) {
      const absolute = mediaFilePath(vaultPath, itemId, file.id, file.filename);
      if (await fs.exists(absolute)) {
        return absolute;
      }
    }
  }

  // Legacy covers (no cover.source.json): sole gallery image is the only
  // possible source — safe without lex-min mismatch among many files.
  if (images.length === 1) {
    const only = images[0]!;
    const absolute = mediaFilePath(vaultPath, itemId, only.id, only.filename);
    if (await fs.exists(absolute)) {
      return absolute;
    }
  }

  return null;
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
