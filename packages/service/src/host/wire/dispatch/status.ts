import { DOMAIN_WIRE_METHODS } from "../domain-methods.js";
import { defineDispatch } from "./types.js";

const M = DOMAIN_WIRE_METHODS;

/** Vault index sync status (#163) + job queue stats (#630). */
export const STATUS_DISPATCH = defineDispatch({
  [M.getVaultIndexSyncStatus]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      return runtime.vaultIndexSyncStatus.get();
    },
  },
  [M.getJobStats]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      return runtime.jobs.stats();
    },
  },
});
