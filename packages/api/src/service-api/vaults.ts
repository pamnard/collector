import type { VaultMeta } from "@collector/shared";

/** Vaults port (#361). */
export interface VaultsPort {
  listVaults(): Promise<VaultMeta[]>;
  getActiveVaultMeta(): Promise<VaultMeta>;
  switchVault(vaultId: string): Promise<VaultMeta>;
  setDefaultVault(vaultId: string): Promise<void>;
}
