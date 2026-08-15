import { dashboardSnapshotSchema } from "@collector/shared";
import { DOMAIN_WIRE_METHODS } from "../domain-methods.js";
import { asObject, badRequest } from "../handlers/params.js";
import { defineDispatch } from "./types.js";

const M = DOMAIN_WIRE_METHODS;

/** Dashboard snapshot I/O (#552). Peek/build stay client-orchestrated. */
export const DASHBOARD_DISPATCH = defineDispatch({
  [M.ensureDashboardSnapshot]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      return runtime.dashboardSnapshot.ensureDashboardSnapshot();
    },
  },
  [M.persistDashboardSnapshot]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.persistDashboardSnapshot);
      if (
        !p.snapshot ||
        typeof p.snapshot !== "object" ||
        Array.isArray(p.snapshot)
      ) {
        badRequest(`${M.persistDashboardSnapshot}: snapshot object required`);
      }
      const snapshot = dashboardSnapshotSchema.parse(p.snapshot);
      await runtime.ensureInitialized();
      await runtime.dashboardSnapshot.persistDashboardSnapshot(snapshot);
      return { ok: true };
    },
  },
  [M.clearDashboardSnapshot]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      await runtime.dashboardSnapshot.clearDashboardSnapshot();
      return { ok: true };
    },
  },
});
