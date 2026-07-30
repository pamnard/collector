import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  ActiveVaultResult,
  UiSessionThumbnailPaths,
} from "@collector/api";
import type { ItemFile } from "@collector/shared";
import type { ServiceIpcClient } from "@collector/service/ipc";

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
