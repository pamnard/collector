/**
 * App-side import surface for frozen `@collector/api` types (#145).
 * Runtime wiring: {@link getCollectorClient} / LocalAdapter (#169).
 */
export type {
  CollectorApiError,
  CollectorServiceApi,
  CreateItemInput,
  DashboardIndexPage,
  NavFilter,
  UpdateItemInput,
  VaultIndexSyncStatus,
} from "@collector/api";
export { DASHBOARD_PREFETCH_SIZE } from "@collector/api";
export type { CollectorClient } from "../services/collector-client";
export {
  createCollectorClient,
  createLocalAdapter,
  getCollectorClient,
  setCollectorClient,
} from "../services/collector-client";
