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

export {
  createTagsFoldersService,
  type ServiceSubscribeHandlers,
  type TagsFoldersService,
  type TagsFoldersServiceDeps,
} from "./tags-folders.js";

export {
  createMediaCoverService,
  type GenerateCoverFromMedia,
  type MediaCoverService,
  type MediaCoverServiceDeps,
  type ResolveThumbnailPathsBatch,
} from "./media-cover.js";

export {
  createVaultIndexSyncStatusStore,
  type VaultIndexSyncStatus,
  type VaultIndexSyncStatusStore,
} from "./sync-status.js";

export {
  createAppSettingsService,
  type AppSettingsService,
  type AppSettingsServiceDeps,
} from "./app-settings.js";

export {
  createDashboardSnapshotService,
  type DashboardSnapshotService,
  type DashboardSnapshotServiceDeps,
} from "./dashboard-snapshot.js";

export {
  createVaultsService,
  type VaultEntry,
  type VaultsService,
  type VaultsServiceDeps,
} from "./vaults.js";

export {
  startServiceHost,
  formatServiceHostReadyLine,
  SERVICE_HOST_READY_PREFIX,
  type ServiceHost,
  type ServiceHostOptions,
} from "./host/service-host.js";

export { NodeSqliteExecutor } from "./host/node-sql.js";

export {
  SERVICE_IPC_PROTOCOL_VERSION,
  ServiceIpcFrameReader,
  ServiceIpcFramingError,
  encodeServiceIpcFrame,
  assertProtocolVersion,
  type ServiceIpcHealthResult,
  type ServiceIpcMessage,
  type ServiceIpcMethod,
  type ServiceIpcRequest,
  type ServiceIpcResponse,
  type ServiceIpcErrorResponse,
} from "./host/ipc/framing.js";

export {
  defaultServiceIpcPath,
  isWindowsNamedPipePath,
} from "./host/ipc/paths.js";

export {
  startServiceIpcServer,
  type ServiceIpcHandler,
  type ServiceIpcServer,
} from "./host/ipc/server.js";

export {
  connectServiceIpc,
  type ServiceIpcClient,
  type ServiceIpcClientOptions,
  type ServiceIpcRequestOptions,
} from "./host/ipc/client.js";

export {
  ServiceIpcError,
  getCollectorApiError,
  isServiceIpcError,
  mapHandlerThrownToApiError,
  mapNodeIpcErrno,
  serviceIpcError,
} from "./host/ipc/errors.js";
