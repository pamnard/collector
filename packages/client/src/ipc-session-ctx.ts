import type {
  UiSessionThumbnailPaths,
  VaultIndexSyncStatus,
} from "@collector/api";
import type { AppSettings, ItemFile } from "@collector/shared";
import type { ServiceIpcClient } from "@collector/service/ipc";
import type { CollectorIpcClientOptions } from "./ipc-client-types.js";

function createNullThumbnailPaths(): UiSessionThumbnailPaths {
  return {
    resolveItemThumbnailPath: async (): Promise<string | null> => null,
    resolveItemThumbnailPaths: async (
      items: ItemFile[],
    ): Promise<Map<string, string | null>> =>
      new Map(items.map((item) => [item.id, null])),
  };
}

/** Shared mutable session for domain port factories (#383). */
export type IpcSessionCtx = {
  transport: ServiceIpcClient;
  thumbnails: UiSessionThumbnailPaths;
  cachedSyncStatus: VaultIndexSyncStatus;
  settingsCache: AppSettings | null;
};

export function createIpcSessionCtx(
  transport: ServiceIpcClient,
  options: CollectorIpcClientOptions = {},
): IpcSessionCtx {
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
