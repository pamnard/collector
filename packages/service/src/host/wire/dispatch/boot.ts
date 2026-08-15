import {
  DOMAIN_WIRE_METHODS,
  type DomainWireMethod,
} from "../domain-methods.js";
import type { DomainDispatchEntry } from "./types.js";

const M = DOMAIN_WIRE_METHODS;

export const BOOT_DISPATCH: Partial<Record<DomainWireMethod, DomainDispatchEntry>> = {
  // #162 index boot
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
};
