/**
 * Cover file pixel size via sharp.metadata — host-only.
 * Never import from the browser `@collector/service` barrel (Vite pulls sharp).
 */

import type { ItemThumbnailPixelSize } from "@collector/api";
import sharp from "sharp";

export async function readCoverPixelSize(
  absolutePath: string,
): Promise<ItemThumbnailPixelSize> {
  const meta = await sharp(absolutePath).metadata();
  const width = meta.width;
  const height = meta.height;
  if (
    !(
      typeof width === "number" &&
      width > 0 &&
      typeof height === "number" &&
      height > 0
    )
  ) {
    throw new Error(
      `cover metadata missing positive width/height: ${absolutePath}`,
    );
  }
  return { width, height };
}
