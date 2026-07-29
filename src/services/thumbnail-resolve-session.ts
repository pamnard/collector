/**
 * UiSession thumbnail path resolution (#368) — desktop FS / dev-mock, not host IPC.
 */

import type { ActiveVaultResult, UiSessionThumbnailPaths } from "@collector/api";
import { resolveItemThumbnailPathsBatch } from "@collector/core";
import type { ItemFile } from "@collector/shared";
import { TauriFileSystemAdapter } from "../adapters/tauri-fs";
import { isDevMock } from "../dev/is-dev-mock";
import * as devMockCollector from "../dev/mock-collector";

const fs = new TauriFileSystemAdapter();

export interface ThumbnailResolveSessionDeps {
  resolveActiveVault: () => Promise<ActiveVaultResult>;
}

export function createThumbnailResolveSession(
  deps: ThumbnailResolveSessionDeps,
): UiSessionThumbnailPaths {
  const resolveItemThumbnailPaths = async (
    items: ItemFile[],
  ): Promise<Map<string, string | null>> => {
    if (items.length === 0) {
      return new Map();
    }

    if (isDevMock()) {
      const resolved = new Map<string, string | null>();
      for (const item of items) {
        resolved.set(
          item.id,
          await devMockCollector.resolveItemThumbnailPath(item),
        );
      }
      return resolved;
    }

    const { path: vaultPath } = await deps.resolveActiveVault();
    const rows = await resolveItemThumbnailPathsBatch(
      fs,
      vaultPath,
      items.map((item) => ({
        id: item.id,
        thumbnail: item.thumbnail ?? null,
      })),
    );
    const resolved = new Map<string, string | null>();
    for (const row of rows) {
      resolved.set(row.id, row.path);
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
