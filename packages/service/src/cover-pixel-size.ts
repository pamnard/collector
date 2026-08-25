/**
 * Cover file pixel size via sharp.metadata — host-only one-time backfill (#822).
 * Never import from the browser `@collector/service` barrel (Vite pulls sharp).
 */

import type { ItemThumbnailPixelSize } from "@collector/api";
import { coverPixelSizeSchema } from "@collector/shared";
import sharp from "sharp";

export async function readCoverPixelSize(
  absolutePath: string,
): Promise<ItemThumbnailPixelSize> {
  const meta = await sharp(absolutePath).metadata();
  const parsed = coverPixelSizeSchema.safeParse({
    width: meta.width,
    height: meta.height,
  });
  if (!parsed.success) {
    throw new Error(
      `cover metadata missing positive width/height: ${absolutePath}`,
    );
  }
  return parsed.data;
}
