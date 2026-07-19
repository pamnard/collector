/**
 * @collector/service — in-process Collector service application module.
 */

export {
  createCollectorIndexBoot,
  type ClosableSqlExecutor,
  type CollectorIndexBoot,
  type CollectorIndexBootDeps,
} from "./index-boot.js";

export {
  createItemsSearchService,
  queryDashboardIndexPage,
  DASHBOARD_PREFETCH_SIZE,
  type DashboardIndexPage,
  type DashboardItemIdsResult,
  type ItemsIndexPort,
  type ItemsSearchService,
  type ItemsSearchServiceDeps,
  type VaultSyncBatchListener,
} from "./items-search.js";
