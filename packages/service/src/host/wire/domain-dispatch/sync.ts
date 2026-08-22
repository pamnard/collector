import { DOMAIN_WIRE_METHODS } from "../domain-methods.js";
import { asObject, requireString } from "../handlers/params.js";
import type { DomainDispatchGroup } from "./types.js";

const M = DOMAIN_WIRE_METHODS;

export const SYNC_DISPATCH = {
  [M.syncNow]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.syncNow);
      const pluginId = requireString(p.pluginId, "pluginId", M.syncNow);
      await runtime.ensureInitialized();
      return runtime.syncPlugins.syncNow(pluginId);
    },
  },
  [M.getVaultIndexSyncStatus]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      return runtime.vaultIndexSyncStatus.get();
    },
  },
  [M.getDerivedCatchUpStatus]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      return runtime.derivedCatchUpStatus.get();
    },
  },
  [M.getJobStats]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      return runtime.jobs.stats();
    },
  },
} satisfies DomainDispatchGroup;
