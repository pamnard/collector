/**
 * IPC handlers: vaults list/switch/ensure (#160).
 */

import {
  asObject,
  requireString,
} from "./params.js";
import { DOMAIN_IPC_METHODS } from "../domain-methods.js";
import type { DomainIpcHandlerMap } from "../domain-methods.js";
import type { ServiceDomainRuntime } from "../../domain-runtime.js";

export function buildVaultsHandlers(
  runtime: ServiceDomainRuntime,
): DomainIpcHandlerMap {
  const { vaults } = runtime;
  const M = DOMAIN_IPC_METHODS;

  return {
    [M.listVaults]: async () => {
      await runtime.ensureInitialized();
      return vaults.listVaults();
    },
    [M.getActiveVaultMeta]: async () => {
      await runtime.ensureInitialized();
      return vaults.getActiveVaultMeta();
    },
    [M.switchVault]: async (params) => {
      const p = asObject(params, M.switchVault);
      const vaultId = requireString(p.vaultId, "vaultId", M.switchVault);
      await runtime.ensureInitialized();
      return vaults.switchVault(vaultId);
    },
    [M.setDefaultVault]: async (params) => {
      const p = asObject(params, M.setDefaultVault);
      const vaultId = requireString(p.vaultId, "vaultId", M.setDefaultVault);
      await runtime.ensureInitialized();
      await vaults.setDefaultVault(vaultId);
      return { ok: true };
    },
    [M.ensureActiveVault]: async () => {
      await runtime.ensureInitialized();
      return vaults.ensureActiveVault();
    },
    [M.getDataDirectory]: async () => runtime.dataDir,
  };
}
