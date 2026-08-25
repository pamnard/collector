/**
 * Thumbnail path resolution over host RPC (#552 / #823).
 * Host returns absolute vault paths (exists + gallery-first); UI maps via /media.
 * Wire batch shape: Array<{ id, path, width, height }> — Maps reconstructed here.
 *
 * Progressive resolve (#823): concurrent per-item wire chunks so `onResolved`
 * can fire for early ids before the rest of the batch finishes (same contract
 * as disk progressive concurrency, #544). Batch `resolveItemThumbnailPaths`
 * remains one RPC for callers that need the full Map.
 */

import {
  positiveThumbnailPixelSize,
  THUMBNAIL_RESOLVE_WIRE_CONCURRENCY,
  type ItemHeroMedia,
  type ItemThumbnailPixelSize,
  type UiSessionThumbnailPaths,
  type UiSessionThumbnailResolveProgressiveOptions,
} from "@collector/api";
import type { ItemFile } from "@collector/shared";
import {
  isHostWireError,
  type HostWireClient,
} from "@collector/service/wire";

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

function sizeFromWireRow(
  row: ThumbnailWireRow,
): ItemThumbnailPixelSize | null {
  if (row.path === null) {
    return null;
  }
  return positiveThumbnailPixelSize(row.width, row.height);
}

function isWireCancel(error: unknown): boolean {
  return isHostWireError(error) && error.code === "cancelled";
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

    const concurrency = Math.max(
      1,
      options.concurrency ?? THUMBNAIL_RESOLVE_WIRE_CONCURRENCY,
    );
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        if (options.signal?.aborted) {
          return;
        }
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) {
          return;
        }

        const item = items[index]!;
        let rows: ThumbnailWireRow[];
        try {
          rows = (await transport.request(
            "resolveItemThumbnailPaths",
            {
              items: [
                {
                  id: item.id,
                  thumbnail: item.thumbnail ?? null,
                },
              ],
            },
            { signal: options.signal },
          )) as ThumbnailWireRow[];
        } catch (error) {
          if (options.signal?.aborted && isWireCancel(error)) {
            return;
          }
          throw error;
        }

        if (options.signal?.aborted) {
          return;
        }

        const row = rows[0];
        if (!row || row.id !== item.id) {
          throw new Error(
            `thumbnail wire row missing for id: ${item.id}`,
          );
        }
        options.onResolved(item.id, row.path, sizeFromWireRow(row));
      }
    };

    const workerCount = Math.min(concurrency, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
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
