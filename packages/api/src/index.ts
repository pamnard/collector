/**
 * @collector/api — transport-agnostic Collector service API (#145 / #361 / #363 / #364).
 * Types, constants, and thin compose / transport helpers. No host, wire, or UI wiring.
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
  ImportFolderFailure,
  ImportFolderInput,
  ImportFolderJobSnapshot,
  ImportFolderJobStatus,
  ImportFolderResult,
  ImportFolderResultStatus,
  IndexSyncPhase,
  IndexSyncProgress,
  MediaWithPath,
  NavFilter,
  TagWithCount,
  UpdateItemInput,
} from "./domain.js";

export type {
  NormalizedSyncItem,
  PullResult,
  SyncCursor,
  SyncPlugin,
} from "./sync-plugin.js";

export {
  DASHBOARD_PREFETCH_SIZE,
  DASHBOARD_HYDRATE_CHUNK_SIZE,
  DASHBOARD_HYDRATE_MAX_IDS,
  SEARCH_PAGE_SIZE,
  SEARCH_PAGE_MAX_LIMIT,
  type ActiveVaultResult,
  type SearchItemsResult,
  type AdjacentItemRef,
  type AdjacentItemsResult,
  type SimilarItemHit,
  type BootPort,
  type CollectorService,
  type CredentialRef,
  type CredentialsAvailability,
  type CredentialsPort,
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
  type JobPermanentFailure,
  type JobStats,
  type JobStatusCounts,
  type JobsPort,
  type ResolvedTextLink,
  type BacklinkSource,
  type MediaPort,
  type ServiceSubscribeHandlers,
  type SettingsPort,
  type Subscription,
  type SyncNowResult,
  type SyncPluginsPort,
  type TagsPort,
  type TelegramBotIdentity,
  type TelegramSyncPort,
  type TelegramSyncSettings,
  type TelegramSyncSettingsPatch,
  type VaultIndexSyncStatus,
  type VaultPresentationChangeKind,
  type VaultPresentationChangedPayload,
  type VaultsPort,
} from "./service-api.js";

export {
  BOOT_PORT_KEYS,
  CREDENTIALS_PORT_KEYS,
  DASHBOARD_SNAPSHOT_PORT_KEYS,
  FOLDERS_PORT_KEYS,
  INDEX_PORT_KEYS,
  ITEMS_PORT_KEYS,
  JOBS_PORT_KEYS,
  MEDIA_PORT_KEYS,
  SETTINGS_PORT_KEYS,
  SYNC_PLUGINS_PORT_KEYS,
  TAGS_PORT_KEYS,
  TELEGRAM_SYNC_PORT_KEYS,
  VAULTS_PORT_KEYS,
} from "./service-compose.js";

export {
  UI_SESSION_SETTINGS_SYNC_KEYS,
  UI_SESSION_SNAPSHOT_KEYS,
  UI_SESSION_THUMBNAIL_KEYS,
  type UiSession,
  type UiSessionSettingsSync,
  type UiSessionThumbnailPaths,
  type UiSessionThumbnailResolveProgressiveOptions,
  type ItemHeroMedia,
  type ItemHeroMediaKind,
} from "./ui-session.js";

export {
  asCollectorApiError,
  subscriptionFromTeardown,
} from "./transport.js";

export {
  assertSearchItemsPage,
  searchItemsPageViolation,
  type SearchItemsPage,
} from "./search-items-page.js";
