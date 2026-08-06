import type { VaultsPort } from "@collector/api";
import type { VaultMeta } from "@collector/shared";
import type { IpcSessionCtx } from "../ipc-session-ctx.js";

export function createIpcVaultsPort(ctx: IpcSessionCtx): VaultsPort {
  const { transport } = ctx;
  return {
    listVaults: async (): Promise<VaultMeta[]> =>
      transport.request("listVaults") as Promise<VaultMeta[]>,
    getActiveVaultMeta: async (): Promise<VaultMeta> =>
      transport.request("getActiveVaultMeta") as Promise<VaultMeta>,
    switchVault: async (vaultId: string): Promise<VaultMeta> =>
      transport.request("switchVault", { vaultId }) as Promise<VaultMeta>,
    setDefaultVault: async (vaultId: string): Promise<void> => {
      await transport.request("setDefaultVault", { vaultId });
    },
  };
}
