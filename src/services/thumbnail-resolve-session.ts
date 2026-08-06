/**
 * UiSession thumbnail path resolution (#368) — DevMock / host cover paths.
 * Progressive emit + bounded parallel resolve (#544).
 * Browser+host cutover uses createHostThumbnailsPort (#552), not this module.
 */

import type {
  ActiveVaultResult,
  UiSessionThumbnailPaths,
  UiSessionThumbnailResolveProgressiveOptions,
} from "@collector/api";
import { itemCoverPath } from "@collector/core";
import type { ItemFile } from "@collector/shared";
import { isDevMock } from "../dev/is-dev-mock";
import * as devMockCollector from "../dev/mock-collector";

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
 * Host cutover thumbnails: build `media/<uuid>/cover.webp` without local FS.
 * Missing file → UI img onerror after /media 404.
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

/** DevMock (and tests): resolve via mock collector only (#555). */
export function createThumbnailResolveSession(
  _deps: ThumbnailResolveSessionDeps,
): UiSessionThumbnailPaths {
  const resolveItemThumbnailPathsProgressiveFn = async (
    items: ItemFile[],
    options: UiSessionThumbnailResolveProgressiveOptions,
  ): Promise<void> => {
    if (items.length === 0) {
      return;
    }

    if (!isDevMock()) {
      throw new Error(
        "createThumbnailResolveSession is DevMock-only; use host thumbnails port (#555)",
      );
    }

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
