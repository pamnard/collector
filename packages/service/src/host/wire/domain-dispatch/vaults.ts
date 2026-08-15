import { DOMAIN_WIRE_METHODS } from "../domain-methods.js";
import { asObject, requireString } from "../handlers/params.js";
import type { DomainDispatchGroup } from "./types.js";

const M = DOMAIN_WIRE_METHODS;

export const VAULTS_DISPATCH = {
  [M.listVaults]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      return runtime.vaults.listVaults();
    },
  },
  [M.getActiveVaultMeta]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      return runtime.vaults.getActiveVaultMeta();
    },
  },
  [M.switchVault]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.switchVault);
      const vaultId = requireString(p.vaultId, "vaultId", M.switchVault);
      await runtime.ensureInitialized();
      const result = await runtime.vaults.switchVault(vaultId);
      await runtime.syncPluginWake.notifyVaultReady();
      return result;
    },
  },
  [M.setDefaultVault]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.setDefaultVault);
      const vaultId = requireString(p.vaultId, "vaultId", M.setDefaultVault);
      await runtime.ensureInitialized();
      await runtime.vaults.setDefaultVault(vaultId);
      return { ok: true };
    },
  },
  [M.ensureActiveVault]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      // Do not wake sync plugins here — thumbnails/dashboard call this path.
      // Boot and switchVault still notifyVaultReady explicitly.
      return runtime.vaults.ensureActiveVault();
    },
  },
  [M.getDataDirectory]: {
    handle: async (runtime) => runtime.dataDir,
  },
} satisfies DomainDispatchGroup;
