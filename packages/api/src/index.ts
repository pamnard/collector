/**
 * @collector/api — frozen transport-agnostic Collector service API types (#145).
 * Types / constants only. No host, IPC, or UI wiring.
 */

export type {
  CollectorApiError,
  CollectorApiErrorBase,
  CollectorApiErrorLayer,
  CollectorApiDomainError,
  CollectorApiTransportError,
  CollectorApiValidationError,
} from "./errors.js";

export type {
  AttachMediaFileInput,
  CreateItemInput,
  FolderTreeNode,
  IndexSyncPhase,
  IndexSyncProgress,
  MediaWithPath,
  NavFilter,
  TagWithCount,
  UpdateItemInput,
} from "./domain.js";

export {
  DASHBOARD_PREFETCH_SIZE,
  type ActiveVaultResult,
  type CollectorServiceApi,
  type DashboardIndexPage,
  type DashboardItemIdsResult,
  type DashboardLoadHandlers,
  type GetItemResult,
  type ServiceSubscribeHandlers,
  type VaultIndexSyncStatus,
} from "./service-api.js";
