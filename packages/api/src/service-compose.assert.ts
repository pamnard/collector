/**
 * Compile-time smoke for #361 port composition.
 * Types only — erased by tsc; no runtime behavior.
 */
import type {
  BootPort,
  CollectorService,
  CollectorServiceApi,
  DashboardSnapshotPort,
  FoldersPort,
  IndexPort,
  ItemsPort,
  MediaPort,
  SettingsPort,
  TagsPort,
  VaultsPort,
} from "./service-api.js";
import type {
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

type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

type PortsIntersection = BootPort &
  ItemsPort &
  TagsPort &
  FoldersPort &
  MediaPort &
  VaultsPort &
  IndexPort &
  SettingsPort &
  DashboardSnapshotPort;

type _ApiIsPortsIntersection = Expect<
  Equal<CollectorServiceApi, PortsIntersection>
>;

type FlatKeys =
  | (typeof BOOT_PORT_KEYS)[number]
  | (typeof ITEMS_PORT_KEYS)[number]
  | (typeof TAGS_PORT_KEYS)[number]
  | (typeof FOLDERS_PORT_KEYS)[number]
  | (typeof MEDIA_PORT_KEYS)[number]
  | (typeof VAULTS_PORT_KEYS)[number]
  | (typeof INDEX_PORT_KEYS)[number]
  | (typeof SETTINGS_PORT_KEYS)[number]
  | (typeof DASHBOARD_SNAPSHOT_PORT_KEYS)[number];

type _KeyofMatchesPortKeys = Expect<Equal<keyof CollectorServiceApi, FlatKeys>>;

/** Same 54 method names as app `REQUIRED_METHODS` (transitional #360/#370). */
type _KeyCount = Expect<
  Equal<
    FlatKeys,
    | "openCollectorDatabase"
    | "ensureCollectorDatabaseHealthy"
    | "ensureActiveVault"
    | "getDataDirectory"
    | "listItems"
    | "searchItems"
    | "fetchDashboardIndexPage"
    | "listDashboardItemIds"
    | "subscribeDashboardLoad"
    | "streamDashboardItems"
    | "loadDashboardItems"
    | "getItemById"
    | "getAdjacentItems"
    | "getItemSource"
    | "updateItemSource"
    | "createItem"
    | "updateItem"
    | "deleteItem"
    | "importDroppedFiles"
    | "subscribeTags"
    | "listTags"
    | "createTag"
    | "updateTagRecord"
    | "deleteTag"
    | "subscribeFolderTree"
    | "listFolderTree"
    | "loadFolderTree"
    | "createFolder"
    | "renameFolder"
    | "deleteFolder"
    | "moveItemToFolderPath"
    | "listItemMedia"
    | "resolveItemThumbnailPath"
    | "resolveItemThumbnailPaths"
    | "setItemCoverFromMedia"
    | "attachMediaFiles"
    | "replaceItemMedia"
    | "deleteItemMedia"
    | "listVaults"
    | "getActiveVaultMeta"
    | "switchVault"
    | "setDefaultVault"
    | "subscribeVaultIndexSyncStatus"
    | "getVaultIndexSyncStatus"
    | "ensureAppSettings"
    | "getAppSettingsSync"
    | "updateAppSettings"
    | "subscribeAppSettings"
    | "getAppConfigDirectory"
    | "ensureDashboardSnapshot"
    | "peekMatchingDashboardSnapshot"
    | "persistDashboardSnapshot"
    | "clearDashboardSnapshot"
    | "buildDashboardSnapshot"
  >
>;

type _ToServiceOk = Expect<
  Equal<
    ReturnType<typeof toCollectorService>,
    CollectorService
  >
>;

type _ToFlatOk = Expect<
  Equal<ReturnType<typeof toCollectorServiceApi>, CollectorServiceApi>
>;

type _CollectorServiceKeys = Expect<
  Equal<
    keyof CollectorService,
    | "boot"
    | "items"
    | "tags"
    | "folders"
    | "media"
    | "vaults"
    | "index"
    | "settings"
  >
>;

type _Asserts = [
  _ApiIsPortsIntersection,
  _KeyofMatchesPortKeys,
  _KeyCount,
  _ToServiceOk,
  _ToFlatOk,
  _CollectorServiceKeys,
];

export type ServiceComposeAsserts = _Asserts;
