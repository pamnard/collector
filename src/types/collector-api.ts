/**
 * App-side import surface for frozen `@collector/api` types (#145).
 * Runtime wiring: {@link getCollectorService} / LocalAdapter (#169 / #369 / #370).
 */
export type {
  CollectorApiError,
  CollectorService,
  CreateItemInput,
  DashboardIndexPage,
  NavFilter,
  UpdateItemInput,
  VaultIndexSyncStatus,
} from "@collector/api";
export { DASHBOARD_PREFETCH_SIZE } from "@collector/api";
export {
  createLocalCollectorService,
  createLocalDashboardSnapshotPort,
  createLocalUiSession,
  getCollectorService,
  getUiSession,
  setCollectorService,
  setUiSession,
} from "../services/collector-client";