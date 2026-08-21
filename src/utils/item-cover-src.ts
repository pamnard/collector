import { toDisplayAssetSrc } from "./asset-src";

/**
 * Display cover URL for collection cards and related teasers.
 * `thumbnailPath` is from {@link UiSession.thumbnails} (disk cover / null).
 * Remote CDN teasers (including YouTube) are not invented at display time (#739).
 */
export function resolveCoverSrc(thumbnailPath: string | null): string | null {
  if (!thumbnailPath) {
    return null;
  }
  return toDisplayAssetSrc(thumbnailPath);
}
