import { toDisplayAssetSrc } from "./asset-src";
import { getYouTubeThumbnail } from "./youtube-thumbnail";

/**
 * Display cover URL for collection cards and related teasers — same rule.
 * `thumbnailPath` is from {@link UiSession.thumbnails} (disk cover / null).
 * YouTube is only a fallback when there is no resolved path.
 */
export function resolveCoverSrc(
  thumbnailPath: string | null,
  itemUrl: string | undefined,
): string | null {
  if (thumbnailPath) {
    return toDisplayAssetSrc(thumbnailPath);
  }
  if (itemUrl) {
    return getYouTubeThumbnail(itemUrl);
  }
  return null;
}
