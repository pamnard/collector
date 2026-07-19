/**
 * IPC handlers: vault index sync status (#163).
 */

import { DOMAIN_IPC_METHODS } from "../domain-methods.js";
import type { DomainIpcHandlerMap } from "../domain-methods.js";
import type { ServiceDomainRuntime } from "../../domain-runtime.js";

export function buildSyncStatusHandlers(
  runtime: ServiceDomainRuntime,
): DomainIpcHandlerMap {
  const M = DOMAIN_IPC_METHODS;

  return {
    [M.getVaultIndexSyncStatus]: async () => {
      await runtime.ensureInitialized();
      return runtime.vaultIndexSyncStatus.get();
    },
  };
}
