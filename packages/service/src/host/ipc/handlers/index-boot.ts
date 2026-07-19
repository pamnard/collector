/**
 * IPC handlers: index DB open / migrate / ensureHealthy (+ rebuild) (#162).
 */

import { DOMAIN_IPC_METHODS } from "../domain-methods.js";
import type { DomainIpcHandlerMap } from "../domain-methods.js";
import type { ServiceDomainRuntime } from "../../domain-runtime.js";

export function buildIndexBootHandlers(
  runtime: ServiceDomainRuntime,
): DomainIpcHandlerMap {
  const M = DOMAIN_IPC_METHODS;

  return {
    [M.openCollectorDatabase]: async () => {
      await runtime.open();
      return { ok: true };
    },
    [M.ensureCollectorDatabaseHealthy]: async () => {
      await runtime.ensureInitialized();
      return { ok: true };
    },
  };
}
