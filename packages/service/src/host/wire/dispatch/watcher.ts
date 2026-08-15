import { DOMAIN_WIRE_METHODS } from "../domain-methods.js";
import { asObject, requireString } from "../handlers/params.js";
import { defineDispatch } from "./types.js";

const M = DOMAIN_WIRE_METHODS;

/** Vault filesystem watcher RPC (#164). */
export const WATCHER_DISPATCH = defineDispatch({
  [M.startVaultFilesystemWatcher]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.startVaultFilesystemWatcher);
      const vaultId = requireString(
        p.vaultId,
        "vaultId",
        M.startVaultFilesystemWatcher,
      );
      const vaultPath = requireString(
        p.vaultPath,
        "vaultPath",
        M.startVaultFilesystemWatcher,
      );
      await runtime.ensureInitialized();
      await runtime.startVaultFilesystemWatcher(vaultId, vaultPath);
      return { ok: true };
    },
  },
  [M.stopVaultFilesystemWatcher]: {
    handle: async (runtime) => {
      await runtime.stopVaultFilesystemWatcher();
      return { ok: true };
    },
  },
  [M.isVaultFilesystemWatcherActive]: {
    handle: async (runtime) => ({
      active: runtime.isVaultFilesystemWatcherActive(),
    }),
  },
});
