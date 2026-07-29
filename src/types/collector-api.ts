/**
 * App-side import surface for frozen `@collector/api` types (#145).
 * Runtime wiring: {@link getCollectorService} / LocalAdapter (#169 / #369).
 */
export type {
  CollectorApiError,
  CollectorService,
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
  createLocalCollectorService,
  createLocalDashboardSnapshotPort,
  createLocalUiSession,
  getCollectorClient,
  getCollectorService,
  getUiSession,
  setCollectorClient,
  setCollectorService,
  setUiSession,
} from "../services/collector-client";