import type { AppSettings } from "@collector/shared";
import { DOMAIN_WIRE_METHODS } from "../domain-methods.js";
import { asObject, badRequest } from "../handlers/params.js";
import { defineDispatch } from "./types.js";

const M = DOMAIN_WIRE_METHODS;

/** App settings (#161). */
export const SETTINGS_DISPATCH = defineDispatch({
  [M.ensureAppSettings]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      return runtime.appSettings.ensureAppSettings();
    },
  },
  [M.updateAppSettings]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.updateAppSettings);
      if (!p.patch || typeof p.patch !== "object" || Array.isArray(p.patch)) {
        badRequest(`${M.updateAppSettings}: patch object required`);
      }
      await runtime.ensureInitialized();
      return runtime.appSettings.updateAppSettings(
        p.patch as Partial<AppSettings>,
      );
    },
  },
  [M.getAppConfigDirectory]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      return runtime.appSettings.getAppConfigDirectory();
    },
  },
});
