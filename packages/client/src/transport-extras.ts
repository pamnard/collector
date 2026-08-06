import type { HostWireClient } from "@collector/service/wire";
import type { CollectorHostTransportExtras } from "./host-client-types.js";

export function createHostTransportExtras(
  transport: HostWireClient,
): CollectorHostTransportExtras {
  return {
    ping: (options) => transport.ping(options),
    health: (options) => transport.health(options),
    close: () => transport.close(),
    startVaultFilesystemWatcher: async (vaultId, vaultPath) => {
      await transport.request("startVaultFilesystemWatcher", {
        vaultId,
        vaultPath,
      });
    },
    stopVaultFilesystemWatcher: async () => {
      await transport.request("stopVaultFilesystemWatcher");
    },
    isVaultFilesystemWatcherActive: async () => {
      const result = (await transport.request(
        "isVaultFilesystemWatcherActive",
      )) as { active: boolean };
      return result.active;
    },
  };
}
