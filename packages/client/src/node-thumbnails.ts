import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  ActiveVaultResult,
  ItemHeroMedia,
  UiSessionThumbnailPaths,
  UiSessionThumbnailResolveProgressiveOptions,
} from "@collector/api";
import { itemCoverPath } from "@collector/core";
import type { ItemFile } from "@collector/shared";
import type { HostWireClient } from "@collector/service/wire";

/**
 * Legacy FM thumbnail path helper. Cover SoT is on-disk `media/<uuid>/cover.webp`
 * (#276/#279) — see {@link createNodeThumbnailPaths}.
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

export function createNodeThumbnailPaths(
  transport: HostWireClient,
): UiSessionThumbnailPaths {
  const resolveItemThumbnailPathsProgressive = async (
    items: ItemFile[],
    options: UiSessionThumbnailResolveProgressiveOptions,
  ): Promise<void> => {
    if (items.length === 0) {
      return;
    }
    const active = (await transport.request(
      "ensureActiveVault",
    )) as ActiveVaultResult;
    for (const item of items) {
      if (options.signal?.aborted) {
        return;
      }
      const cover = itemCoverPath(active.path, item.id);
      if (existsSync(cover)) {
        options.onResolved(item.id, cover);
        continue;
      }
      options.onResolved(
        item.id,
        resolveThumbnailCandidate(
          active.path,
          item.id,
          item.thumbnail ?? null,
        ),
      );
    }
  };

  const resolveItemThumbnailPaths = async (
    items: ItemFile[],
  ): Promise<Map<string, string | null>> => {
    const resolved = new Map<string, string | null>();
    await resolveItemThumbnailPathsProgressive(items, {
      onResolved: (id, path) => {
        resolved.set(id, path);
      },
    });
    return resolved;
  };

  return {
    resolveItemThumbnailPaths,
    resolveItemThumbnailPathsProgressive,
    async resolveItemThumbnailPath(item: ItemFile): Promise<string | null> {
      const paths = await resolveItemThumbnailPaths([item]);
      return paths.get(item.id) ?? null;
    },
    async resolveItemHeroMedia(item: ItemFile): Promise<ItemHeroMedia | null> {
      return (await transport.request("resolveItemHeroMedia", {
        item: { id: item.id },
      })) as ItemHeroMedia | null;
    },
  };
}
