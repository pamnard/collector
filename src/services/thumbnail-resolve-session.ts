/**
 * UiSession thumbnail path resolution (#368) — DevMock only.
 * Progressive emit (#544). Browser+host cutover uses createHostThumbnailsPort (#552).
 */

import type {
  ActiveVaultResult,
  UiSessionThumbnailPaths,
  UiSessionThumbnailResolveProgressiveOptions,
} from "@collector/api";
import type { ItemFile } from "@collector/shared";
import { isDevMock } from "../dev/is-dev-mock";
import * as devMockCollector from "../dev/mock-collector";

export interface ThumbnailResolveSessionDeps {
  resolveActiveVault: () => Promise<ActiveVaultResult>;
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
