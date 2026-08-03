import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  ActiveVaultResult,
  UiSessionThumbnailPaths,
} from "@collector/api";
import { itemCoverPath } from "@collector/core";
import type { ItemFile } from "@collector/shared";
import type { ServiceIpcClient } from "@collector/service/ipc";

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
  if (thumbnail.startsWith("/") || /^[A-Za-z]:/.test(thumbnail)) {
    return existsSync(thumbnail) ? thumbnail : null;
  }
  if (thumbnail.startsWith("http://") || thumbnail.startsWith("https://")) {
    return thumbnail;
  }
  const folder = dirname(itemId);
  const candidate =
    folder && folder !== "."
      ? join(vaultPath, folder, thumbnail)
      : join(vaultPath, thumbnail);
  return existsSync(candidate) ? candidate : null;
}

export function createNodeThumbnailPaths(
  transport: ServiceIpcClient,
): UiSessionThumbnailPaths {
  const resolveItemThumbnailPaths = async (
    items: ItemFile[],
  ): Promise<Map<string, string | null>> => {
    if (items.length === 0) {
      return new Map();
    }
    const active = (await transport.request(
      "ensureActiveVault",
    )) as ActiveVaultResult;
    const resolved = new Map<string, string | null>();
    for (const item of items) {
      const cover = itemCoverPath(active.path, item.id);
      if (existsSync(cover)) {
        resolved.set(item.id, cover);
        continue;
      }
      resolved.set(
        item.id,
        resolveThumbnailCandidate(
          active.path,
          item.id,
          item.thumbnail ?? null,
        ),
      );
    }
    return resolved;
  };

  return {
    resolveItemThumbnailPaths,
    async resolveItemThumbnailPath(item: ItemFile): Promise<string | null> {
      const paths = await resolveItemThumbnailPaths([item]);
      return paths.get(item.id) ?? null;
    },
  };
}
