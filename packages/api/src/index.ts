/**
 * @collector/api — transport-agnostic Collector service API (#145 / #361 / #363 / #364).
 * Types, constants, and thin compose / transport helpers. No host, IPC, or UI wiring.
 *
 * Gate for new methods: a {@link CollectorService} domain port **or**
 * {@link UiSession} — nowhere else.
 */

export type {
  CollectorApiError,
  CollectorApiErrorBase,
  CollectorApiErrorLayer,
  CollectorApiAuthError,
  CollectorApiDomainError,
  CollectorApiTransportError,
  CollectorApiValidationError,
} from "./errors.js";

export type {
  AttachMediaFileInput,
  BinaryPayload,
  CreateItemInput,
  FolderTreeNode,
  ImportDroppedFileInput,
  ImportDroppedFilesInput,
  ImportDroppedFilesResult,
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
  type AdjacentItemRef,
  type AdjacentItemsResult,
  type BootPort,
  type CollectorService,
  type CollectorServiceApi,
  type DashboardIndexPage,
  type DashboardItemIdsResult,
  type DashboardItemSort,
  type DashboardItemSortDir,
  type DashboardLoadHandlers,
  type DashboardSnapshotPort,
  type FoldersPort,
  type GetItemResult,
  type IndexPort,
  type IndexQueryResult,
  type ItemsPort,
  type MediaPort,
  type ServiceSubscribeHandlers,
  type SettingsPort,
  type Subscription,
  type TagsPort,
  type VaultIndexSyncStatus,
  type VaultsPort,
} from "./service-api.js";

export {
  BOOT_PORT_KEYS,
  DASHBOARD_SNAPSHOT_PORT_KEYS,
  FOLDERS_PORT_KEYS,
  INDEX_PORT_KEYS,
  ITEMS_PORT_KEYS,
  MEDIA_PORT_KEYS,
  SETTINGS_PORT_KEYS,
  TAGS_PORT_KEYS,
  toCollectorService,
  toCollectorServiceApi,
  VAULTS_PORT_KEYS,
} from "./service-compose.js";

export {
  toUiSession,
  UI_SESSION_SETTINGS_SYNC_KEYS,
  UI_SESSION_SNAPSHOT_KEYS,
  UI_SESSION_THUMBNAIL_KEYS,
  type UiSession,
  type UiSessionSettingsSync,
  type UiSessionThumbnailPaths,
} from "./ui-session.js";

export {
  asCollectorApiError,
  subscriptionFromTeardown,
} from "./transport.js";
