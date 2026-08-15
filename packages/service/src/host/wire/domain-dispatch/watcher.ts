import { DOMAIN_WIRE_METHODS } from "../domain-methods.js";
import { asObject, requireString } from "../handlers/params.js";
import type { DomainDispatchGroup } from "./types.js";

const M = DOMAIN_WIRE_METHODS;

export const WATCHER_DISPATCH = {
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
} satisfies DomainDispatchGroup;
