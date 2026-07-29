/**
 * In-process LocalAdapter for web/dev-mock and unit tests (#169 / #171 / #328 / #365).
 *
 * Desktop Tauri default path uses IPC (#170). This adapter is a thin mock
 * facade — UI in-process SQLite and vault-index sync were removed (#171 / #328).
 *
 * Ports are primary ({@link createLocalCollectorService}); flat
 * {@link CollectorServiceApi} is a transitional shim via {@link toCollectorServiceApi}.
 */

import type {
  CollectorService,
  CollectorServiceApi,
  DashboardSnapshotPort,
  NavFilter as ApiNavFilter,
} from "@collector/api";
import { toCollectorServiceApi } from "@collector/api";
import type { NavFilter as UiNavFilter } from "../types/ui";
import type {
  CreateItemInput as UiCreateItemInput,
  UpdateItemInput as UiUpdateItemInput,
} from "../types/item";
import * as collector from "./collector-service";
import {
  ensureAppSettings,
  getAppConfigDirectory,
  getAppSettingsSync,
  subscribeAppSettings,
  updateAppSettings,
} from "./app-settings-service";
import {
  buildDashboardSnapshot as buildDashboardSnapshotLocal,
  clearDashboardSnapshot,
  ensureDashboardSnapshot,
  peekMatchingDashboardSnapshot as peekMatchingDashboardSnapshotLocal,
  persistDashboardSnapshot,
} from "./dashboard-snapshot-service";

function asUiNavFilter(filter: ApiNavFilter): UiNavFilter {
  return filter as UiNavFilter;
}

/** Domain ports for in-process LocalAdapter (#365). */
export function createLocalCollectorService(): CollectorService {
  return {
    boot: {
      openCollectorDatabase: collector.openCollectorDatabase,
      ensureCollectorDatabaseHealthy: collector.ensureCollectorDatabaseHealthy,
      ensureActiveVault: collector.ensureActiveVault,
      getDataDirectory: collector.getDataDirectory,
    },
    items: {
      listItems: collector.listItems,
      searchItems: (query, filter) =>
        collector.searchItems(query, asUiNavFilter(filter)),
      queryIndex: (filter, query, page, sort) =>
        collector.queryIndex(asUiNavFilter(filter), query, page, sort),
      hydrate: collector.hydrate,
      fetchDashboardIndexPage: (filter, query, page, sort) =>
        collector.fetchDashboardIndexPage(
          asUiNavFilter(filter),
          query,
          page,
          sort,
        ),
      listDashboardItemIds: (filter, query, sort) =>
        collector.listDashboardItemIds(asUiNavFilter(filter), query, sort),
      subscribeDashboardLoad: (filter, query, handlers, signal, sort) =>
        collector.subscribeDashboardLoad(
          asUiNavFilter(filter),
          query,
          handlers,
          signal,
          sort,
        ),
      streamDashboardItems: collector.streamDashboardItems,
      loadDashboardItems: collector.loadDashboardItems,
      getItemById: collector.getItemById,
      getAdjacentItems: collector.getAdjacentItems,
      getItemSource: collector.getItemSource,
      updateItemSource: collector.updateItemSource,
      createItem: (input) => collector.createItem(input as UiCreateItemInput),
      updateItem: (itemId, input) =>
        collector.updateItem(itemId, input as UiUpdateItemInput),
      deleteItem: collector.deleteItem,
      importDroppedFiles: collector.importDroppedFiles,
    },
    tags: {
      subscribeTags: collector.subscribeTags,
      listTags: collector.listTags,
      createTag: collector.createTag,
      updateTagRecord: collector.updateTagRecord,
      deleteTag: collector.deleteTag,
    },
    folders: {
      subscribeFolderTree: collector.subscribeFolderTree,
      listFolderTree: collector.listFolderTree,
      loadFolderTree: collector.loadFolderTree,
      createFolder: collector.createFolder,
      renameFolder: collector.renameFolder,
      deleteFolder: collector.deleteFolder,
      moveItemToFolderPath: collector.moveItemToFolderPath,
    },
    media: {
      listItemMedia: collector.listItemMedia,
      resolveItemThumbnailPath: collector.resolveItemThumbnailPath,
      resolveItemThumbnailPaths: collector.resolveItemThumbnailPaths,
      setItemCoverFromMedia: collector.setItemCoverFromMedia,
      attachMediaFiles: collector.attachMediaFiles,
      replaceItemMedia: collector.replaceItemMedia,
      deleteItemMedia: collector.deleteItemMedia,
    },
    vaults: {
      listVaults: collector.listVaults,
      getActiveVaultMeta: collector.getActiveVaultMeta,
      switchVault: collector.switchVault,
      setDefaultVault: collector.setDefaultVault,
    },
    index: {
      subscribeVaultIndexSyncStatus: collector.subscribeVaultIndexSyncStatus,
      getVaultIndexSyncStatus: collector.getVaultIndexSyncStatus,
    },
    settings: {
      ensureAppSettings,
      getAppSettingsSync,
      updateAppSettings,
      subscribeAppSettings,
      getAppConfigDirectory,
    },
  };
}

/** Dashboard snapshot slice for flat shim / UiSession (#363 / #365). */
export function createLocalDashboardSnapshotPort(): DashboardSnapshotPort {
  return {
    ensureDashboardSnapshot,
    peekMatchingDashboardSnapshot: (input) =>
      peekMatchingDashboardSnapshotLocal(
        input.vaultId,
        asUiNavFilter(input.filter),
        input.search,
        input.sort,
      ),
    persistDashboardSnapshot,
    clearDashboardSnapshot,
    buildDashboardSnapshot: (input) =>
      buildDashboardSnapshotLocal({
        ...input,
        filter: asUiNavFilter(input.filter),
      }),
  };
}

/**
 * Transitional flat facade (#145 → #360). Prefer
 * {@link createLocalCollectorService} + {@link createLocalDashboardSnapshotPort}.
 */
export function createLocalAdapter(): CollectorServiceApi {
  return toCollectorServiceApi(
    createLocalCollectorService(),
    createLocalDashboardSnapshotPort(),
  );
}
