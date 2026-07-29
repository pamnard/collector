import type { ItemFile } from "@collector/shared";
import { getUiSession } from "../services/collector-client";

/**
 * Resolve on-disk cover paths for dashboard items.
 * Does not wait for image decode — that is per-card in ItemGridCard.
 */
export async function resolveDashboardCoverPaths(
  items: ItemFile[],
): Promise<Map<string, string | null>> {
  if (items.length === 0) {
    return new Map();
  }
  return getUiSession().thumbnails.resolveItemThumbnailPaths(items);
}
