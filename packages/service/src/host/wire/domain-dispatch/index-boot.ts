import { DOMAIN_WIRE_METHODS } from "../domain-methods.js";
import type { DomainDispatchGroup } from "./types.js";

const M = DOMAIN_WIRE_METHODS;

export const INDEX_BOOT_DISPATCH = {
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
} satisfies DomainDispatchGroup;
