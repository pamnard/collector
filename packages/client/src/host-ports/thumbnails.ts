/**
 * Thumbnail path resolution over host RPC (#552).
 * Host returns absolute vault paths (exists + gallery-first); UI maps via /media.
 * Wire batch shape: Array<{ id, path }> — Map is reconstructed on the client.
 */

import type {
  UiSessionThumbnailPaths,
  UiSessionThumbnailResolveProgressiveOptions,
} from "@collector/api";
import type { ItemFile } from "@collector/shared";
import type { HostWireClient } from "@collector/service/wire";

type ThumbnailWireRow = { id: string; path: string | null };

function wireRowsToMap(rows: ThumbnailWireRow[]): Map<string, string | null> {
  return new Map(rows.map((row) => [row.id, row.path]));
}

export function createHostThumbnailsPort(
  transport: HostWireClient,
): UiSessionThumbnailPaths {
  const resolveItemThumbnailPaths = async (
    items: ItemFile[],
  ): Promise<Map<string, string | null>> => {
    if (items.length === 0) {
      return new Map();
    }
    const rows = (await transport.request("resolveItemThumbnailPaths", {
      items: items.map((item) => ({
        id: item.id,
        thumbnail: item.thumbnail ?? null,
      })),
    })) as ThumbnailWireRow[];
    return wireRowsToMap(rows);
  };

  const resolveItemThumbnailPathsProgressive = async (
    items: ItemFile[],
    options: UiSessionThumbnailResolveProgressiveOptions,
  ): Promise<void> => {
    if (items.length === 0) {
      return;
    }
    if (options.signal?.aborted) {
      return;
    }
    const resolved = await resolveItemThumbnailPaths(items);
    for (const item of items) {
      if (options.signal?.aborted) {
        return;
      }
      options.onResolved(item.id, resolved.get(item.id) ?? null);
    }
  };

  return {
    resolveItemThumbnailPaths,
    resolveItemThumbnailPathsProgressive,
    async resolveItemThumbnailPath(item: ItemFile): Promise<string | null> {
      const path = (await transport.request("resolveItemThumbnailPath", {
        item: { id: item.id, thumbnail: item.thumbnail ?? null },
      })) as string | null;
      return path;
    },
  };
}
