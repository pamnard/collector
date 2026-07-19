/**
 * App-side import surface for frozen `@collector/api` types (#145).
 * Type-only; no runtime wiring / LocalAdapter yet (#169).
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
