/**
 * IPC handlers: vault filesystem watcher orchestration (#164).
 */

import { DOMAIN_IPC_METHODS } from "../domain-methods.js";
import type { DomainIpcHandlerMap } from "../domain-methods.js";
import type { ServiceDomainRuntime } from "../../domain-runtime.js";
import { asObject, requireString } from "./params.js";

export function buildWatcherHandlers(
  runtime: ServiceDomainRuntime,
): DomainIpcHandlerMap {
  const M = DOMAIN_IPC_METHODS;

  return {
    [M.startVaultFilesystemWatcher]: async (params) => {
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
    [M.stopVaultFilesystemWatcher]: async () => {
      await runtime.stopVaultFilesystemWatcher();
      return { ok: true };
    },
    [M.isVaultFilesystemWatcherActive]: async () => {
      return { active: runtime.isVaultFilesystemWatcherActive() };
    },
  };
}
