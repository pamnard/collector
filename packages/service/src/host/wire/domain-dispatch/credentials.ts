import { DOMAIN_WIRE_METHODS } from "../domain-methods.js";
import { asObject, requireString } from "../handlers/params.js";
import type { DomainDispatchGroup } from "./types.js";

const M = DOMAIN_WIRE_METHODS;

export const CREDENTIALS_DISPATCH = {
  [M.setCredential]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.setCredential);
      const pluginId = requireString(p.pluginId, "pluginId", M.setCredential);
      const key = requireString(p.key, "key", M.setCredential);
      const secret = requireString(p.secret, "secret", M.setCredential);
      await runtime.credentials.setCredential({ pluginId, key, secret });
      return { ok: true };
    },
  },
  [M.getCredential]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.getCredential);
      const pluginId = requireString(p.pluginId, "pluginId", M.getCredential);
      const key = requireString(p.key, "key", M.getCredential);
      return runtime.credentials.getCredential({ pluginId, key });
    },
  },
  [M.hasCredential]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.hasCredential);
      const pluginId = requireString(p.pluginId, "pluginId", M.hasCredential);
      const key = requireString(p.key, "key", M.hasCredential);
      return runtime.credentials.hasCredential({ pluginId, key });
    },
  },
  [M.deleteCredential]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.deleteCredential);
      const pluginId = requireString(
        p.pluginId,
        "pluginId",
        M.deleteCredential,
      );
      const key = requireString(p.key, "key", M.deleteCredential);
      await runtime.credentials.deleteCredential({ pluginId, key });
      return { ok: true };
    },
  },
  [M.getCredentialsAvailability]: {
    handle: async (runtime) => runtime.credentials.getCredentialsAvailability(),
  },
} satisfies DomainDispatchGroup;
