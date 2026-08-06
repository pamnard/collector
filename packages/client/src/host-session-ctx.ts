import type {
  UiSessionThumbnailPaths,
  UiSessionThumbnailResolveProgressiveOptions,
  VaultIndexSyncStatus,
} from "@collector/api";
import type { AppSettings, ItemFile } from "@collector/shared";
import type { HostWireClient } from "@collector/service/wire";
import type { CollectorHostClientOptions } from "./host-client-types.js";

function createNullThumbnailPaths(): UiSessionThumbnailPaths {
  return {
    resolveItemThumbnailPath: async (): Promise<string | null> => null,
    resolveItemThumbnailPaths: async (
      items: ItemFile[],
    ): Promise<Map<string, string | null>> =>
      new Map(items.map((item) => [item.id, null])),
    resolveItemThumbnailPathsProgressive: async (
      items: ItemFile[],
      options: UiSessionThumbnailResolveProgressiveOptions,
    ): Promise<void> => {
      for (const item of items) {
        if (options.signal?.aborted) {
          return;
        }
        options.onResolved(item.id, null);
      }
    },
  };
}

/** Shared mutable session for domain port factories (#383). */
export type HostSessionCtx = {
  transport: HostWireClient;
  thumbnails: UiSessionThumbnailPaths;
  cachedSyncStatus: VaultIndexSyncStatus;
  settingsCache: AppSettings | null;
};

export function createHostSessionCtx(
  transport: HostWireClient,
  options: CollectorHostClientOptions = {},
): HostSessionCtx {
  return {
    transport,
    thumbnails: options.thumbnails ?? createNullThumbnailPaths(),
    cachedSyncStatus: {
      vaultId: null,
      status: "idle",
      progress: null,
      metadataReady: true,
      ftsReady: true,
    },
    settingsCache: null,
  };
}
