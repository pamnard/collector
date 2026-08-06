import type { ActiveVaultResult, BootPort } from "@collector/api";
import type { HostSessionCtx } from "../host-session-ctx.js";

export function createHostBootPort(ctx: HostSessionCtx): BootPort {
  const { transport } = ctx;
  return {
    openCollectorDatabase: async (): Promise<void> => {
      await transport.request("openCollectorDatabase");
    },
    ensureCollectorDatabaseHealthy: async (): Promise<void> => {
      await transport.request("ensureCollectorDatabaseHealthy");
    },
    ensureActiveVault: async (): Promise<ActiveVaultResult> =>
      transport.request("ensureActiveVault") as Promise<ActiveVaultResult>,
    getDataDirectory: async (): Promise<string> =>
      transport.request("getDataDirectory") as Promise<string>,
  };
}
