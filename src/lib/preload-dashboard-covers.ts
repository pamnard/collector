import type {
  UiSessionThumbnailResolveProgressiveOptions,
} from "@collector/api";
import type { ItemFile } from "@collector/shared";
import { getUiSession } from "../services/collector-client";

/**
 * Resolve on-disk cover paths for dashboard items.
 * Does not wait for image decode — that is per-card in ItemGridCard.
 */
export async function resolveDashboardCoverPathsProgressive(
  items: ItemFile[],
  options: UiSessionThumbnailResolveProgressiveOptions,
): Promise<void> {
  if (items.length === 0) {
    return;
  }
  await getUiSession().thumbnails.resolveItemThumbnailPathsProgressive(
    items,
    options,
  );
}
