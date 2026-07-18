import type { ItemFile } from "@collector/shared";
import { resolveItemThumbnailPaths } from "../services/collector-service";

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
  return resolveItemThumbnailPaths(items);
}
