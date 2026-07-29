/**
 * IPC handlers: app settings (#161). Dashboard snapshot is UiSession / client FS (#368).
 */

import type { AppSettings } from "@collector/shared";
import {
  asObject,
  badRequest,
} from "./params.js";
import { DOMAIN_IPC_METHODS } from "../domain-methods.js";
import type { DomainIpcHandlerMap } from "../domain-methods.js";
import type { ServiceDomainRuntime } from "../../domain-runtime.js";

export function buildSettingsSnapshotHandlers(
  runtime: ServiceDomainRuntime,
): DomainIpcHandlerMap {
  const { appSettings } = runtime;
  const M = DOMAIN_IPC_METHODS;

  return {
    [M.ensureAppSettings]: async () => {
      await runtime.ensureInitialized();
      return appSettings.ensureAppSettings();
    },
    [M.updateAppSettings]: async (params) => {
      const p = asObject(params, M.updateAppSettings);
      if (!p.patch || typeof p.patch !== "object" || Array.isArray(p.patch)) {
        badRequest(`${M.updateAppSettings}: patch object required`);
      }
      await runtime.ensureInitialized();
      return appSettings.updateAppSettings(p.patch as Partial<AppSettings>);
    },
    [M.getAppConfigDirectory]: async () => {
      await runtime.ensureInitialized();
      return appSettings.getAppConfigDirectory();
    },
  };
}
