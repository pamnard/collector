/**
 * Node domain-host cover generation (#255).
 * Browser path uses canvas in `src/services/thumbnail-service.ts`.
 */

import type { MediaType } from "@collector/shared";
import sharp from "sharp";

const COVER_MAX_EDGE = 480;
const COVER_WEBP_QUALITY = 85;

export async function generateCoverFromMedia(
  data: Uint8Array,
  _filename: string,
  mediaType: MediaType,
): Promise<Uint8Array | null> {
  if (mediaType !== "image") {
    // Video frame extract needs ffmpeg; match soft-fail of browser video path.
    return null;
  }

  const buffer = await sharp(Buffer.from(data))
    .rotate()
    .resize({
      width: COVER_MAX_EDGE,
      height: COVER_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: COVER_WEBP_QUALITY })
    .toBuffer();

  return new Uint8Array(buffer);
}
