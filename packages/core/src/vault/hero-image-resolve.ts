/**
 * Detail hero media: which gallery/cover file is chosen, and its kind.
 *
 * Order: gallery image → gallery video → cover.webp.
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
  const galleryImage = await findFirstGalleryImagePath(fs, vaultPath, itemId);
  if (galleryImage !== null) {
    return {
      kind: "image",
      filePath: galleryImage,
      displayPath: galleryImage,
    };
  }

  const galleryVideo = await findFirstGalleryVideoPath(fs, vaultPath, itemId);
  if (galleryVideo !== null) {
    const cover = itemCoverPath(vaultPath, itemId);
    const hasCover = await fs.exists(cover);
    return {
      kind: "video",
      filePath: galleryVideo,
      displayPath: hasCover ? cover : null,
    };
  }

  const cover = itemCoverPath(vaultPath, itemId);
  if (await fs.exists(cover)) {
    return {
      kind: "image",
      filePath: cover,
      displayPath: cover,
    };
  }

  return null;
}
