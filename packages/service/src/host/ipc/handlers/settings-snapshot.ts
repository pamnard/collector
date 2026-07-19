/**
 * IPC handlers: app settings + dashboard snapshot (#161).
 */

import type { AppSettings, DashboardSnapshot } from "@collector/shared";
import type { NavFilter } from "@collector/api";
import {
  asObject,
  badRequest,
  parseNavFilter,
  requireString,
} from "./params.js";
import { DOMAIN_IPC_METHODS } from "../domain-methods.js";
import type { DomainIpcHandlerMap } from "../domain-methods.js";
import type { ServiceDomainRuntime } from "../../domain-runtime.js";

export function buildSettingsSnapshotHandlers(
  runtime: ServiceDomainRuntime,
): DomainIpcHandlerMap {
  const { appSettings, dashboardSnapshot } = runtime;
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
    [M.ensureDashboardSnapshot]: async () => {
      await runtime.ensureInitialized();
      return dashboardSnapshot.ensureDashboardSnapshot();
    },
    [M.persistDashboardSnapshot]: async (params) => {
      const p = asObject(params, M.persistDashboardSnapshot);
      if (
        !p.snapshot ||
        typeof p.snapshot !== "object" ||
        Array.isArray(p.snapshot)
      ) {
        badRequest(`${M.persistDashboardSnapshot}: snapshot object required`);
      }
      await runtime.ensureInitialized();
      await dashboardSnapshot.persistDashboardSnapshot(
        p.snapshot as DashboardSnapshot,
      );
      return { ok: true };
    },
    [M.clearDashboardSnapshot]: async () => {
      await runtime.ensureInitialized();
      await dashboardSnapshot.clearDashboardSnapshot();
      return { ok: true };
    },
    [M.peekMatchingDashboardSnapshot]: async (params) => {
      const p = asObject(params, M.peekMatchingDashboardSnapshot);
      const vaultId = requireString(
        p.vaultId,
        "vaultId",
        M.peekMatchingDashboardSnapshot,
      );
      const filter = parseNavFilter(p.filter, M.peekMatchingDashboardSnapshot);
      const search =
        typeof p.search === "string"
          ? p.search
          : badRequest(
              `${M.peekMatchingDashboardSnapshot}: search must be a string`,
            );
      await runtime.ensureInitialized();
      await dashboardSnapshot.ensureDashboardSnapshot();
      return dashboardSnapshot.peekMatchingDashboardSnapshot({
        vaultId,
        filter,
        search,
      });
    },
    [M.buildDashboardSnapshot]: async (params) => {
      const p = asObject(params, M.buildDashboardSnapshot);
      const vaultId = requireString(
        p.vaultId,
        "vaultId",
        M.buildDashboardSnapshot,
      );
      const filter = parseNavFilter(p.filter, M.buildDashboardSnapshot);
      if (typeof p.search !== "string") {
        badRequest(`${M.buildDashboardSnapshot}: search must be a string`);
      }
      if (!Array.isArray(p.itemIds) || !p.itemIds.every((id) => typeof id === "string")) {
        badRequest(`${M.buildDashboardSnapshot}: itemIds must be string[]`);
      }
      if (!Array.isArray(p.items)) {
        badRequest(`${M.buildDashboardSnapshot}: items must be an array`);
      }
      if (typeof p.totalCount !== "number") {
        badRequest(`${M.buildDashboardSnapshot}: totalCount must be a number`);
      }
      if (typeof p.streamEndOffset !== "number") {
        badRequest(
          `${M.buildDashboardSnapshot}: streamEndOffset must be a number`,
        );
      }
      await runtime.ensureInitialized();
      return dashboardSnapshot.buildDashboardSnapshot({
        vaultId,
        filter: filter as NavFilter,
        search: p.search,
        itemIds: p.itemIds,
        items: p.items as DashboardSnapshot["items"],
        totalCount: p.totalCount,
        streamEndOffset: p.streamEndOffset,
      });
    },
  };
}
