/**
 * Thumbnail path resolution over host RPC (#552).
 * Host returns absolute vault paths (exists + gallery-first); UI maps via /media.
 * Wire batch shape: Array<{ id, path, width, height }> — Maps reconstructed here.
 */

import {
  positiveThumbnailPixelSize,
  type ItemHeroMedia,
  type ItemThumbnailPixelSize,
  type UiSessionThumbnailPaths,
  type UiSessionThumbnailResolveProgressiveOptions,
} from "@collector/api";
import type { ItemFile } from "@collector/shared";
import type { HostWireClient } from "@collector/service/wire";

type ThumbnailWireRow = {
  id: string;
  path: string | null;
  width?: number | null;
  height?: number | null;
};

type ThumbnailWireMaps = {
  paths: Map<string, string | null>;
  sizes: Map<string, ItemThumbnailPixelSize | null>;
};

function wireRowsToMaps(rows: ThumbnailWireRow[]): ThumbnailWireMaps {
  const paths = new Map<string, string | null>();
  const sizes = new Map<string, ItemThumbnailPixelSize | null>();
  for (const row of rows) {
    paths.set(row.id, row.path);
    sizes.set(
      row.id,
      row.path === null ? null : positiveThumbnailPixelSize(row.width, row.height),
    );
  }
  return { paths, sizes };
}

export function createHostThumbnailsPort(
  transport: HostWireClient,
): UiSessionThumbnailPaths {
  const resolveItemThumbnailWireMaps = async (
    items: ItemFile[],
  ): Promise<ThumbnailWireMaps> => {
    if (items.length === 0) {
      return { paths: new Map(), sizes: new Map() };
    }
    const rows = (await transport.request("resolveItemThumbnailPaths", {
      items: items.map((item) => ({
        id: item.id,
        thumbnail: item.thumbnail ?? null,
      })),
    })) as ThumbnailWireRow[];
    return wireRowsToMaps(rows);
  };

  const resolveItemThumbnailPaths = async (
    items: ItemFile[],
  ): Promise<Map<string, string | null>> => {
    const { paths } = await resolveItemThumbnailWireMaps(items);
    return paths;
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
    const { paths, sizes } = await resolveItemThumbnailWireMaps(items);
    for (const item of items) {
      if (options.signal?.aborted) {
        return;
      }
      options.onResolved(
        item.id,
        paths.get(item.id) ?? null,
        sizes.get(item.id) ?? null,
      );
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
    async resolveItemHeroMedia(item: ItemFile): Promise<ItemHeroMedia | null> {
      return (await transport.request("resolveItemHeroMedia", {
        item: { id: item.id },
      })) as ItemHeroMedia | null;
    },
  };
}
