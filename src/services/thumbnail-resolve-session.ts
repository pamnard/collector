/**
 * UiSession thumbnail path resolution (#368) — desktop FS / dev-mock / host cover bridge (#553).
 * Progressive emit + bounded parallel resolve (#544).
 * Full host-side disk resolve (exists + first gallery image) is #552.
 */

import type {
  ActiveVaultResult,
  UiSessionThumbnailPaths,
  UiSessionThumbnailResolveProgressiveOptions,
} from "@collector/api";
import {
  itemCoverPath,
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

function isRemoteThumbnailUrl(value: string | null | undefined): value is string {
  return (
    typeof value === "string" &&
    (value.startsWith("http://") || value.startsWith("https://"))
  );
}

/** Canonical cover path or remote FM URL — no local FS probe (#553). */
export function resolveHostCoverThumbnailPath(
  vaultPath: string,
  item: Pick<ItemFile, "id" | "thumbnail">,
): string | null {
  if (isRemoteThumbnailUrl(item.thumbnail)) {
    return item.thumbnail;
  }
  return itemCoverPath(vaultPath, item.id);
}

/**
 * Host cutover thumbnails: build `media/<uuid>/cover.webp` without Tauri FS.
 * Missing file → UI img onerror after /media 404. Gallery-first fallback → #552.
 */
export function createHostCoverThumbnailSession(
  deps: ThumbnailResolveSessionDeps,
): UiSessionThumbnailPaths {
  const resolveItemThumbnailPathsProgressiveFn = async (
    items: ItemFile[],
    options: UiSessionThumbnailResolveProgressiveOptions,
  ): Promise<void> => {
    if (items.length === 0) {
      return;
    }
    const { path: vaultPath } = await deps.resolveActiveVault();
    for (const item of items) {
      if (options.signal?.aborted) {
        return;
      }
      options.onResolved(
        item.id,
        resolveHostCoverThumbnailPath(vaultPath, item),
      );
    }
  };

  const resolveItemThumbnailPaths = async (
    items: ItemFile[],
  ): Promise<Map<string, string | null>> => {
    const resolved = new Map<string, string | null>();
    await resolveItemThumbnailPathsProgressiveFn(items, {
      onResolved: (id, path) => {
        resolved.set(id, path);
      },
    });
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

export function createThumbnailResolveSession(
  deps: ThumbnailResolveSessionDeps,
): UiSessionThumbnailPaths {
  const resolveItemThumbnailPathsProgressiveFn = async (
    items: ItemFile[],
    options: UiSessionThumbnailResolveProgressiveOptions,
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
    const resolved = new Map<string, string | null>();
    await resolveItemThumbnailPathsProgressiveFn(items, {
      onResolved: (id, path) => {
        resolved.set(id, path);
      },
    });
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
