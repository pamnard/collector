/**
 * Detail hero media: which gallery/cover file is chosen, and its kind.
 *
 * Display SoT matches dashboard thumbnails (#276): `cover.webp` when present
 * (the chosen preview). Gallery-first duplicated “preferred cover” and broke
 * when the cover was set from a non-lex-min gallery file.
 *
 * Video-only items keep Play on the gallery video with cover.webp as poster.
 * Play affordance follows kind === "video" (the chosen file), not item content_type.
 */

import type { FileSystemAdapter } from "../adapters/types.js";
import {
  findFirstGalleryImagePath,
  findFirstGalleryVideoPath,
} from "./media-io.js";
import { itemCoverPath } from "./paths.js";

export type ItemHeroMediaKind = "image" | "video";

export interface ItemHeroMedia {
  kind: ItemHeroMediaKind;
  /** Chosen file (gallery image, gallery video, or cover.webp). */
  filePath: string;
  /**
   * Path for `<img>`: image/cover file, or cover.webp poster when kind is video.
   * Null when kind is video and no cover exists yet.
   */
  displayPath: string | null;
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
    return {
      kind: "image",
      filePath: cover,
      displayPath: cover,
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
