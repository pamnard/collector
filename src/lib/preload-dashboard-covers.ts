import type { ItemFile } from "@collector/shared";
import { getUiSession } from "../services/collector-client";

/**
 * Resolve on-disk cover paths for dashboard items.
 * Does not wait for image decode — that is per-card in ItemGridCard.
 */

export async function resolveDashboardCoverPathsProgressive(
  items: ItemFile[],
  options: {
    onResolved: (id: string, path: string | null) => void;
    signal?: AbortSignal;
    concurrency?: number;
  },
): Promise<void> {
  if (items.length === 0) {
    return;
  }
  await getUiSession().thumbnails.resolveItemThumbnailPathsProgressive(
    items,
    options,
  );
}

/** Collect full Map (tests / one-shot callers). Dashboard uses progressive. */
export async function resolveDashboardCoverPaths(
  items: ItemFile[],
): Promise<Map<string, string | null>> {
  const resolved = new Map<string, string | null>();
  await resolveDashboardCoverPathsProgressive(items, {
    onResolved: (id, path) => {
      resolved.set(id, path);
    },
  });
  return resolved;
}
