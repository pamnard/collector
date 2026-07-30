import type { ActiveVaultResult, BootPort } from "@collector/api";
import type { IpcSessionCtx } from "../ipc-session-ctx.js";

export function createIpcBootPort(ctx: IpcSessionCtx): BootPort {
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
