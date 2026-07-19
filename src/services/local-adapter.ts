/**
 * In-process LocalAdapter for the UI CollectorClient (#169 / epic #142).
 *
 * Delegates to the existing facade modules. Default product path stays
 * in-process; IPC cutover is #170.
 */

import type { CollectorServiceApi, NavFilter as ApiNavFilter } from "@collector/api";
import type { NavFilter as UiNavFilter } from "../types/ui";
import type { CreateItemInput as UiCreateItemInput, UpdateItemInput as UiUpdateItemInput } from "../types/item";
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

/**
 * Build the default UI client implementation (in-process sole writer today).
 */
export function createLocalAdapter(): CollectorServiceApi {
  return {
    openCollectorDatabase: collector.openCollectorDatabase,
    ensureCollectorDatabaseHealthy: collector.ensureCollectorDatabaseHealthy,
    ensureActiveVault: collector.ensureActiveVault,
    getDataDirectory: collector.getDataDirectory,

    listItems: collector.listItems,
    searchItems: (query, filter) =>
      collector.searchItems(query, asUiNavFilter(filter)),
    fetchDashboardIndexPage: (filter, query, page) =>
      collector.fetchDashboardIndexPage(asUiNavFilter(filter), query, page),
    listDashboardItemIds: (filter, query) =>
      collector.listDashboardItemIds(asUiNavFilter(filter), query),
    subscribeDashboardLoad: (filter, query, handlers, signal) =>
      collector.subscribeDashboardLoad(
        asUiNavFilter(filter),
        query,
        handlers,
        signal,
      ),
    streamDashboardItems: collector.streamDashboardItems,
    loadDashboardItems: collector.loadDashboardItems,
    getItemById: collector.getItemById,
    getItemSource: collector.getItemSource,
    updateItemSource: collector.updateItemSource,
    createItem: (input) =>
      collector.createItem(input as UiCreateItemInput),
    updateItem: (itemId, input) =>
      collector.updateItem(itemId, input as UiUpdateItemInput),
    deleteItem: collector.deleteItem,

    subscribeTags: collector.subscribeTags,
    listTags: collector.listTags,
    createTag: collector.createTag,
    updateTagRecord: collector.updateTagRecord,
    deleteTag: collector.deleteTag,

    subscribeFolderTree: collector.subscribeFolderTree,
    listFolderTree: collector.listFolderTree,
    loadFolderTree: collector.loadFolderTree,
    createFolder: collector.createFolder,
    renameFolder: collector.renameFolder,
    deleteFolder: collector.deleteFolder,
    moveItemToFolderPath: collector.moveItemToFolderPath,

    listItemMedia: collector.listItemMedia,
    resolveItemThumbnailPath: collector.resolveItemThumbnailPath,
    resolveItemThumbnailPaths: collector.resolveItemThumbnailPaths,
    setItemCoverFromMedia: collector.setItemCoverFromMedia,
    attachMediaFiles: collector.attachMediaFiles,
    deleteItemMedia: collector.deleteItemMedia,

    listVaults: collector.listVaults,
    getActiveVaultMeta: collector.getActiveVaultMeta,
    switchVault: collector.switchVault,
    setDefaultVault: collector.setDefaultVault,

    subscribeVaultIndexSyncStatus: collector.subscribeVaultIndexSyncStatus,
    getVaultIndexSyncStatus: collector.getVaultIndexSyncStatus,

    ensureAppSettings,
    getAppSettingsSync,
    updateAppSettings,
    subscribeAppSettings,
    getAppConfigDirectory,

    ensureDashboardSnapshot,
    peekMatchingDashboardSnapshot: (input) =>
      peekMatchingDashboardSnapshotLocal(
        input.vaultId,
        asUiNavFilter(input.filter),
        input.search,
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
