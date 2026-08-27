import { DOMAIN_WIRE_METHODS } from "../domain-methods.js";
import type { DomainDispatchGroup } from "./types.js";

const M = DOMAIN_WIRE_METHODS;

/** Tags wire: list only — catalog is derived from documents (#842). */
export const TAGS_DISPATCH = {
  [M.listTags]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      return runtime.tagsFolders.listTags();
    },
  },
} satisfies DomainDispatchGroup;
