/**
 * UiSession thumbnail path resolution (#368) — desktop FS / dev-mock, not host IPC.
 * Progressive emit + bounded parallel resolve (#544).
 */

import type { ActiveVaultResult, UiSessionThumbnailPaths } from "@collector/api";
import {
  resolveItemThumbnailPathsBatch,
  resolveItemThumbnailPathsProgressive,
} from "@collector/core";
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
  const resolveItemThumbnailPathsProgressiveFn = async (
    items: ItemFile[],
    options: {
      onResolved: (id: string, path: string | null) => void;
      signal?: AbortSignal;
      concurrency?: number;
    },
  ): Promise<void> => {
    if (items.length === 0) {
      return;
    }

    if (isDevMock()) {
      for (const item of items) {
        if (options.signal?.aborted) {
          return;
        }
        const path = await devMockCollector.resolveItemThumbnailPath(item);
        if (options.signal?.aborted) {
          return;
        }
        options.onResolved(item.id, path);
      }
      return;
    }

    const { path: vaultPath } = await deps.resolveActiveVault();
    await resolveItemThumbnailPathsProgressive(
      fs,
      vaultPath,
      items.map((item) => ({
        id: item.id,
        thumbnail: item.thumbnail ?? null,
      })),
      {
        concurrency: options.concurrency,
        signal: options.signal,
        onResolved: (result) => {
          options.onResolved(result.id, result.path);
        },
      },
    );
  };

  const resolveItemThumbnailPaths = async (
    items: ItemFile[],
  ): Promise<Map<string, string | null>> => {
    if (items.length === 0) {
      return new Map();
    }

    if (isDevMock()) {
      const resolved = new Map<string, string | null>();
      await resolveItemThumbnailPathsProgressiveFn(items, {
        onResolved: (id, path) => {
          resolved.set(id, path);
        },
      });
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
    resolveItemThumbnailPathsProgressive:
      resolveItemThumbnailPathsProgressiveFn,
    async resolveItemThumbnailPath(item: ItemFile): Promise<string | null> {
      const paths = await resolveItemThumbnailPaths([item]);
      return paths.get(item.id) ?? null;
    },
  };
}
