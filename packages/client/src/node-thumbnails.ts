import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { UiSessionThumbnailPaths } from "@collector/api";
import type { HostWireClient } from "@collector/service/wire";
import { createHostThumbnailsPort } from "./host-ports/thumbnails.js";

/**
 * Legacy FM thumbnail path helper. Cover SoT is on-disk `media/<uuid>/cover.webp`
 * (#276/#279). Prefer {@link createNodeThumbnailPaths} / host wire for display.
 */
export function resolveThumbnailCandidate(
  vaultPath: string,
  itemId: string,
  thumbnail: string | null,
): string | null {
  if (!thumbnail) {
    return null;
  }
  if (thumbnail.startsWith("http://") || thumbnail.startsWith("https://")) {
    // Remote URLs are not vault display assets (#739).
    return null;
  }
  if (thumbnail.startsWith("/") || /^[A-Za-z]:/.test(thumbnail)) {
    return existsSync(thumbnail) ? thumbnail : null;
  }
  const folder = dirname(itemId);
  const candidate =
    folder && folder !== "."
      ? join(vaultPath, folder, thumbnail)
      : join(vaultPath, thumbnail);
  return existsSync(candidate) ? candidate : null;
}

/** Node UI session thumbnails — same host wire batch as browser (path + size). */
export function createNodeThumbnailPaths(
  transport: HostWireClient,
): UiSessionThumbnailPaths {
  return createHostThumbnailsPort(transport);
}
