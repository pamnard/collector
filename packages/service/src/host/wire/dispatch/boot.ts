import { DOMAIN_WIRE_METHODS } from "../domain-methods.js";
import { defineDispatch } from "./types.js";

const M = DOMAIN_WIRE_METHODS;

/** Boot + session directory (#162 / BootPort). */
export const BOOT_DISPATCH = defineDispatch({
  [M.openCollectorDatabase]: {
    handle: async (runtime) => {
      await runtime.open();
      return { ok: true };
    },
  },
  [M.ensureCollectorDatabaseHealthy]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
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
});
