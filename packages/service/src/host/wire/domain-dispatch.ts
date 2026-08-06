/**
 * Domain IPC request handler (#330).
 *
 * One locality: validate params + call {@link ServiceDomainRuntime}.
 * Flat method names remain transitional wire aliases for domain ports (#366).
 *
 * Init policy: each entry that needs a ready session calls
 * `ensureInitialized` **after** param validation (validate-before-init).
 */

import type {
  AttachMediaFileInput,
  CreateItemInput,
  ImportDroppedFilesInput,
  UpdateItemInput,
} from "@collector/api";
import type { AppSettings, ItemFile } from "@collector/shared";
import { dashboardSnapshotSchema } from "@collector/shared";
import type { ServiceDomainRuntime } from "../domain-runtime.js";
import {
  DOMAIN_WIRE_METHODS,
  type DomainWireHandlerMap,
  type DomainWireMethod,
} from "./domain-methods.js";
import { assertHostPortWireCoverage } from "./domain-port-wire.js";
import {
  asObject,
  badRequest,
  parseDashboardItemSort,
  parseNavFilter,
  requireString,
} from "./handlers/params.js";

const M = DOMAIN_WIRE_METHODS;

type DomainDispatchEntry = {
  handle: (
    runtime: ServiceDomainRuntime,
    params: unknown,
  ) => Promise<unknown>;
};

function requireFileName(
  row: Record<string, unknown>,
  label: string,
  method: string,
): string {
  if (typeof row.name === "string" && row.name.length > 0) {
    return row.name;
  }
  if (typeof row.filename === "string" && row.filename.length > 0) {
    return row.filename;
  }
  badRequest(`${method}: ${label} name or filename required`);
}

function decodeDroppedFiles(
  files: unknown,
  method: string,
): ImportDroppedFilesInput["files"] {
  if (!Array.isArray(files)) {
    badRequest(`${method}: files array required`);
  }
  return files.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      badRequest(`${method}: files[${index}] object required`);
    }
    const r = row as Record<string, unknown>;
    if (typeof r.relativePath !== "string" || !r.relativePath) {
      badRequest(`${method}: files[${index}].relativePath required`);
    }
    const name = requireFileName(r, `files[${index}]`, method);
    if (typeof r.dataBase64 !== "string") {
      badRequest(`${method}: files[${index}].dataBase64 required`);
    }
    return {
      relativePath: r.relativePath,
      name,
      bytes: Uint8Array.from(Buffer.from(r.dataBase64, "base64")),
    };
  });
}

function decodeMediaFiles(
  value: unknown,
  method: string,
): AttachMediaFileInput[] {
  if (!Array.isArray(value)) {
    badRequest(`${method}: files must be an array`);
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      badRequest(`${method}: files[${index}] must be an object`);
    }
    const row = entry as Record<string, unknown>;
    const name = requireFileName(row, `files[${index}]`, method);
    if (typeof row.dataBase64 !== "string") {
      badRequest(`${method}: files[${index}].dataBase64 must be a string`);
    }
    return {
      name,
      bytes: Uint8Array.from(Buffer.from(row.dataBase64, "base64")),
    };
  });
}

/** Full host registry: every {@link DomainWireMethod} has exactly one entry. */
export const DOMAIN_DISPATCH_REGISTRY: Record<
  DomainWireMethod,
  DomainDispatchEntry
> = {
  // #162 index boot
  [M.openCollectorDatabase]: {
    handle: async (runtime) => {
      await runtime.open();
      return { ok: true };
    },
  },
  [M.ensureCollectorDatabaseHealthy]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      return { ok: true };
    },
  },

  // #155 reads
  [M.searchItems]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.searchItems);
      const query = requireString(p.query, "query", M.searchItems);
      const filter = parseNavFilter(p.filter, M.searchItems);
      await runtime.ensureInitialized();
      return runtime.itemsSearch.searchItems(query, filter);
    },
  },
  [M.fetchDashboardIndexPage]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.fetchDashboardIndexPage);
      const filter = parseNavFilter(p.filter, M.fetchDashboardIndexPage);
      const query = typeof p.query === "string" ? p.query : undefined;
      if (!p.page || typeof p.page !== "object" || Array.isArray(p.page)) {
        badRequest(`${M.fetchDashboardIndexPage}: page required`);
      }
      const page = p.page as Record<string, unknown>;
      if (typeof page.limit !== "number" || typeof page.offset !== "number") {
        badRequest(`${M.fetchDashboardIndexPage}: page.limit/offset required`);
      }
      const sort = parseDashboardItemSort(p.sort, M.fetchDashboardIndexPage);
      await runtime.ensureInitialized();
      return runtime.itemsSearch.fetchDashboardIndexPage(
        filter,
        query,
        { limit: page.limit, offset: page.offset },
        sort,
      );
    },
  },
  [M.queryIndex]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.queryIndex);
      const filter = parseNavFilter(p.filter, M.queryIndex);
      const query = typeof p.query === "string" ? p.query : undefined;
      if (!p.page || typeof p.page !== "object" || Array.isArray(p.page)) {
        badRequest(`${M.queryIndex}: page required`);
      }
      const page = p.page as Record<string, unknown>;
      if (typeof page.limit !== "number" || typeof page.offset !== "number") {
        badRequest(`${M.queryIndex}: page.limit/offset required`);
      }
      const sort = parseDashboardItemSort(p.sort, M.queryIndex);
      await runtime.ensureInitialized();
      return runtime.itemsSearch.queryIndex(
        filter,
        query,
        { limit: page.limit, offset: page.offset },
        sort,
      );
    },
  },
  [M.listDashboardItemIds]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.listDashboardItemIds);
      const filter = parseNavFilter(p.filter, M.listDashboardItemIds);
      const query = typeof p.query === "string" ? p.query : undefined;
      const sort = parseDashboardItemSort(p.sort, M.listDashboardItemIds);
      await runtime.ensureInitialized();
      return runtime.itemsSearch.listDashboardItemIds(filter, query, sort);
    },
  },
  [M.loadDashboardItems]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.loadDashboardItems);
      if (
        !Array.isArray(p.itemIds) ||
        !p.itemIds.every((id) => typeof id === "string")
      ) {
        badRequest(`${M.loadDashboardItems}: itemIds must be string[]`);
      }
      if (typeof p.offset !== "number") {
        badRequest(`${M.loadDashboardItems}: offset must be a number`);
      }
      const limit = typeof p.limit === "number" ? p.limit : undefined;
      await runtime.ensureInitialized();
      return runtime.itemsSearch.loadDashboardItems(p.itemIds, p.offset, limit);
    },
  },
  [M.getItemById]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.getItemById);
      const itemId = requireString(p.itemId, "itemId", M.getItemById);
      await runtime.ensureInitialized();
      return runtime.itemsSearch.getItemById(itemId);
    },
  },
  [M.getAdjacentItems]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.getAdjacentItems);
      const itemId = requireString(p.itemId, "itemId", M.getAdjacentItems);
      await runtime.ensureInitialized();
      return runtime.itemsSearch.getAdjacentItems(itemId);
    },
  },
  [M.getItemSource]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.getItemSource);
      const itemId = requireString(p.itemId, "itemId", M.getItemSource);
      await runtime.ensureInitialized();
      return runtime.itemsSearch.getItemSource(itemId);
    },
  },

  // #156 writes
  [M.createItem]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.createItem);
      if (typeof p.title !== "string" || p.title.length === 0) {
        badRequest(`${M.createItem}: title required`);
      }
      if (typeof p.content_type !== "string") {
        badRequest(`${M.createItem}: content_type required`);
      }
      await runtime.ensureInitialized();
      return runtime.itemsSearch.createItem(p as unknown as CreateItemInput);
    },
  },
  [M.updateItem]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.updateItem);
      const itemId = requireString(p.itemId, "itemId", M.updateItem);
      if (!p.input || typeof p.input !== "object" || Array.isArray(p.input)) {
        badRequest(`${M.updateItem}: input object required`);
      }
      await runtime.ensureInitialized();
      return runtime.itemsSearch.updateItem(itemId, p.input as UpdateItemInput);
    },
  },
  [M.deleteItem]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.deleteItem);
      const itemId = requireString(p.itemId, "itemId", M.deleteItem);
      await runtime.ensureInitialized();
      await runtime.itemsSearch.deleteItem(itemId);
      return { ok: true };
    },
  },
  [M.updateItemSource]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.updateItemSource);
      const itemId = requireString(p.itemId, "itemId", M.updateItemSource);
      const rawMarkdown = requireString(
        p.rawMarkdown,
        "rawMarkdown",
        M.updateItemSource,
      );
      await runtime.ensureInitialized();
      return runtime.itemsSearch.updateItemSource(itemId, rawMarkdown);
    },
  },
  [M.importDroppedFiles]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.importDroppedFiles);
      const files = decodeDroppedFiles(p.files, M.importDroppedFiles);
      const folder_path =
        typeof p.folder_path === "string" ? p.folder_path : undefined;
      await runtime.ensureInitialized();
      return runtime.dropImport.importDroppedFiles({ folder_path, files });
    },
  },

  // #157 tags
  [M.listTags]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      return runtime.tagsFolders.listTags();
    },
  },
  [M.createTag]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.createTag);
      const name = requireString(p.name, "name", M.createTag);
      const color =
        p.color === undefined
          ? undefined
          : p.color === null
            ? null
            : typeof p.color === "string"
              ? p.color
              : badRequest(`${M.createTag}: color must be string or null`);
      await runtime.ensureInitialized();
      return runtime.tagsFolders.createTag({ name, color });
    },
  },
  [M.updateTagRecord]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.updateTagRecord);
      const tagId = requireString(p.tagId, "tagId", M.updateTagRecord);
      if (!p.input || typeof p.input !== "object" || Array.isArray(p.input)) {
        badRequest(`${M.updateTagRecord}: input object required`);
      }
      const input = p.input as Record<string, unknown>;
      const patch: { name?: string; color?: string | null } = {};
      if (input.name !== undefined) {
        if (typeof input.name !== "string" || input.name.length === 0) {
          badRequest(
            `${M.updateTagRecord}: input.name must be a non-empty string`,
          );
        }
        patch.name = input.name;
      }
      if (input.color !== undefined) {
        if (input.color !== null && typeof input.color !== "string") {
          badRequest(
            `${M.updateTagRecord}: input.color must be string or null`,
          );
        }
        patch.color = input.color as string | null;
      }
      await runtime.ensureInitialized();
      return runtime.tagsFolders.updateTagRecord(tagId, patch);
    },
  },
  [M.deleteTag]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.deleteTag);
      const tagId = requireString(p.tagId, "tagId", M.deleteTag);
      await runtime.ensureInitialized();
      await runtime.tagsFolders.deleteTag(tagId);
      return { ok: true };
    },
  },

  // #158 folders
  [M.listFolderTree]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      return runtime.tagsFolders.listFolderTree();
    },
  },
  [M.createFolder]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.createFolder);
      const folderPath = requireString(
        p.folderPath,
        "folderPath",
        M.createFolder,
      );
      await runtime.ensureInitialized();
      return runtime.tagsFolders.createFolder(folderPath);
    },
  },
  [M.renameFolder]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.renameFolder);
      const oldPath = requireString(p.oldPath, "oldPath", M.renameFolder);
      const newPath = requireString(p.newPath, "newPath", M.renameFolder);
      await runtime.ensureInitialized();
      return runtime.tagsFolders.renameFolder(oldPath, newPath);
    },
  },
  [M.deleteFolder]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.deleteFolder);
      const folderPath = requireString(
        p.folderPath,
        "folderPath",
        M.deleteFolder,
      );
      await runtime.ensureInitialized();
      await runtime.tagsFolders.deleteFolder(folderPath);
      return { ok: true };
    },
  },
  [M.moveItemToFolderPath]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.moveItemToFolderPath);
      const itemId = requireString(p.itemId, "itemId", M.moveItemToFolderPath);
      const folderPath = requireString(
        p.folderPath,
        "folderPath",
        M.moveItemToFolderPath,
      );
      await runtime.ensureInitialized();
      return runtime.tagsFolders.moveItemToFolderPath(itemId, folderPath);
    },
  },

  // #159 media
  [M.listItemMedia]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.listItemMedia);
      const itemId = requireString(p.itemId, "itemId", M.listItemMedia);
      await runtime.ensureInitialized();
      return runtime.mediaCover.listItemMedia(itemId);
    },
  },
  [M.setItemCoverFromMedia]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.setItemCoverFromMedia);
      const itemId = requireString(p.itemId, "itemId", M.setItemCoverFromMedia);
      const mediaId = requireString(
        p.mediaId,
        "mediaId",
        M.setItemCoverFromMedia,
      );
      await runtime.ensureInitialized();
      return runtime.mediaCover.setItemCoverFromMedia(itemId, mediaId);
    },
  },
  [M.attachMediaFiles]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.attachMediaFiles);
      const itemId = requireString(p.itemId, "itemId", M.attachMediaFiles);
      const files = decodeMediaFiles(p.files, M.attachMediaFiles);
      await runtime.ensureInitialized();
      return runtime.mediaCover.attachMediaFiles(itemId, files);
    },
  },
  [M.replaceItemMedia]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.replaceItemMedia);
      const itemId = requireString(p.itemId, "itemId", M.replaceItemMedia);
      const mediaId = requireString(p.mediaId, "mediaId", M.replaceItemMedia);
      if (!p.file || typeof p.file !== "object" || Array.isArray(p.file)) {
        badRequest(`${M.replaceItemMedia}: file object required`);
      }
      const [decoded] = decodeMediaFiles([p.file], M.replaceItemMedia);
      await runtime.ensureInitialized();
      return runtime.mediaCover.replaceItemMedia(itemId, mediaId, decoded!);
    },
  },
  [M.deleteItemMedia]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.deleteItemMedia);
      const itemId = requireString(p.itemId, "itemId", M.deleteItemMedia);
      const mediaId = requireString(p.mediaId, "mediaId", M.deleteItemMedia);
      await runtime.ensureInitialized();
      await runtime.mediaCover.deleteItemMedia(itemId, mediaId);
      return { ok: true };
    },
  },

  // #160 vaults
  [M.listVaults]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      return runtime.vaults.listVaults();
    },
  },
  [M.getActiveVaultMeta]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      return runtime.vaults.getActiveVaultMeta();
    },
  },
  [M.switchVault]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.switchVault);
      const vaultId = requireString(p.vaultId, "vaultId", M.switchVault);
      await runtime.ensureInitialized();
      const result = await runtime.vaults.switchVault(vaultId);
      await runtime.syncPluginWake.notifyVaultReady();
      return result;
    },
  },
  [M.setDefaultVault]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.setDefaultVault);
      const vaultId = requireString(p.vaultId, "vaultId", M.setDefaultVault);
      await runtime.ensureInitialized();
      await runtime.vaults.setDefaultVault(vaultId);
      return { ok: true };
    },
  },
  [M.ensureActiveVault]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      // Do not wake sync plugins here — thumbnails/dashboard call this path.
      // Boot and switchVault still notifyVaultReady explicitly.
      return runtime.vaults.ensureActiveVault();
    },
  },
  [M.getDataDirectory]: {
    handle: async (runtime) => runtime.dataDir,
  },

  // #161 settings
  [M.ensureAppSettings]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      return runtime.appSettings.ensureAppSettings();
    },
  },
  [M.updateAppSettings]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.updateAppSettings);
      if (!p.patch || typeof p.patch !== "object" || Array.isArray(p.patch)) {
        badRequest(`${M.updateAppSettings}: patch object required`);
      }
      await runtime.ensureInitialized();
      return runtime.appSettings.updateAppSettings(
        p.patch as Partial<AppSettings>,
      );
    },
  },
  [M.getAppConfigDirectory]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      return runtime.appSettings.getAppConfigDirectory();
    },
  },

  // #30 credentials (OS keychain; no vault init required)
  [M.setCredential]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.setCredential);
      const pluginId = requireString(p.pluginId, "pluginId", M.setCredential);
      const key = requireString(p.key, "key", M.setCredential);
      const secret = requireString(p.secret, "secret", M.setCredential);
      await runtime.credentials.setCredential({ pluginId, key, secret });
      return { ok: true };
    },
  },
  [M.getCredential]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.getCredential);
      const pluginId = requireString(p.pluginId, "pluginId", M.getCredential);
      const key = requireString(p.key, "key", M.getCredential);
      return runtime.credentials.getCredential({ pluginId, key });
    },
  },
  [M.hasCredential]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.hasCredential);
      const pluginId = requireString(p.pluginId, "pluginId", M.hasCredential);
      const key = requireString(p.key, "key", M.hasCredential);
      return runtime.credentials.hasCredential({ pluginId, key });
    },
  },
  [M.deleteCredential]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.deleteCredential);
      const pluginId = requireString(
        p.pluginId,
        "pluginId",
        M.deleteCredential,
      );
      const key = requireString(p.key, "key", M.deleteCredential);
      await runtime.credentials.deleteCredential({ pluginId, key });
      return { ok: true };
    },
  },
  [M.getCredentialsAvailability]: {
    handle: async (runtime) => runtime.credentials.getCredentialsAvailability(),
  },

  // #29 sync plugin registry (run entrypoint only — not settings)
  [M.syncNow]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.syncNow);
      const pluginId = requireString(p.pluginId, "pluginId", M.syncNow);
      await runtime.ensureInitialized();
      return runtime.syncPlugins.syncNow(pluginId);
    },
  },

  // #415 Telegram Path C settings
  [M.getTelegramSyncSettings]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      return runtime.telegramSync.getTelegramSyncSettings();
    },
  },
  [M.updateTelegramSyncSettings]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.updateTelegramSyncSettings);
      await runtime.ensureInitialized();
      return runtime.telegramSync.updateTelegramSyncSettings({
        ...(typeof p.enabled === "boolean" ? { enabled: p.enabled } : {}),
        ...(typeof p.folder_path === "string"
          ? { folder_path: p.folder_path }
          : {}),
        ...(p.bot_username === null || typeof p.bot_username === "string"
          ? { bot_username: p.bot_username as string | null }
          : {}),
        ...(p.last_sync_at === null || typeof p.last_sync_at === "string"
          ? { last_sync_at: p.last_sync_at as string | null }
          : {}),
        ...(typeof p.sync_interval_ms === "number"
          ? { sync_interval_ms: p.sync_interval_ms }
          : {}),
      });
    },
  },
  [M.validateTelegramBotToken]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.validateTelegramBotToken);
      const token = requireString(
        p.token,
        "token",
        M.validateTelegramBotToken,
      );
      await runtime.ensureInitialized();
      return runtime.telegramSync.validateTelegramBotToken({ token });
    },
  },

  // #163 sync status
  [M.getVaultIndexSyncStatus]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      return runtime.vaultIndexSyncStatus.get();
    },
  },


  // #552 dashboard snapshot I/O (peek/build stay client-orchestrated)
  [M.ensureDashboardSnapshot]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      return runtime.dashboardSnapshot.ensureDashboardSnapshot();
    },
  },
  [M.persistDashboardSnapshot]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.persistDashboardSnapshot);
      if (!p.snapshot || typeof p.snapshot !== "object" || Array.isArray(p.snapshot)) {
        badRequest(`${M.persistDashboardSnapshot}: snapshot object required`);
      }
      const snapshot = dashboardSnapshotSchema.parse(p.snapshot);
      await runtime.ensureInitialized();
      await runtime.dashboardSnapshot.persistDashboardSnapshot(snapshot);
      return { ok: true };
    },
  },
  [M.clearDashboardSnapshot]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      await runtime.dashboardSnapshot.clearDashboardSnapshot();
      return { ok: true };
    },
  },

  // #552 thumbnail resolve (absolute vault paths; UI maps via /media)
  [M.resolveItemThumbnailPath]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.resolveItemThumbnailPath);
      if (!p.item || typeof p.item !== "object" || Array.isArray(p.item)) {
        badRequest(`${M.resolveItemThumbnailPath}: item object required`);
      }
      const item = p.item as Record<string, unknown>;
      const id = requireString(item.id, "item.id", M.resolveItemThumbnailPath);
      const thumbnail =
        item.thumbnail === null || item.thumbnail === undefined
          ? null
          : requireString(item.thumbnail, "item.thumbnail", M.resolveItemThumbnailPath);
      await runtime.ensureInitialized();
      return runtime.mediaCover.resolveItemThumbnailPath({
        id,
        thumbnail,
      } as ItemFile);
    },
  },
  [M.resolveItemThumbnailPaths]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.resolveItemThumbnailPaths);
      if (!Array.isArray(p.items)) {
        badRequest(`${M.resolveItemThumbnailPaths}: items array required`);
      }
      const items: ItemFile[] = p.items.map((row, index) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) {
          badRequest(`${M.resolveItemThumbnailPaths}: items[${index}] object required`);
        }
        const r = row as Record<string, unknown>;
        const id = requireString(
          r.id,
          `items[${index}].id`,
          M.resolveItemThumbnailPaths,
        );
        const thumbnail =
          r.thumbnail === null || r.thumbnail === undefined
            ? null
            : typeof r.thumbnail === "string"
              ? r.thumbnail
              : badRequest(
                  `${M.resolveItemThumbnailPaths}: items[${index}].thumbnail must be string or null`,
                );
        return { id, thumbnail } as ItemFile;
      });
      await runtime.ensureInitialized();
      const resolved = await runtime.mediaCover.resolveItemThumbnailPaths(items);
      return Array.from(resolved, ([id, path]) => ({ id, path }));
    },
  },

  // #164 watcher
  [M.startVaultFilesystemWatcher]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.startVaultFilesystemWatcher);
      const vaultId = requireString(
        p.vaultId,
        "vaultId",
        M.startVaultFilesystemWatcher,
      );
      const vaultPath = requireString(
        p.vaultPath,
        "vaultPath",
        M.startVaultFilesystemWatcher,
      );
      await runtime.ensureInitialized();
      await runtime.startVaultFilesystemWatcher(vaultId, vaultPath);
      return { ok: true };
    },
  },
  [M.stopVaultFilesystemWatcher]: {
    handle: async (runtime) => {
      await runtime.stopVaultFilesystemWatcher();
      return { ok: true };
    },
  },
  [M.isVaultFilesystemWatcherActive]: {
    handle: async (runtime) => ({
      active: runtime.isVaultFilesystemWatcherActive(),
    }),
  },
};

function assertDomainRegistryCoverage(): void {
  const catalog = new Set<string>(Object.values(DOMAIN_WIRE_METHODS));
  const registryKeys = Object.keys(DOMAIN_DISPATCH_REGISTRY);
  const missingFromRegistry: string[] = [];
  const extraInRegistry: string[] = [];

  for (const method of catalog) {
    if (!(method in DOMAIN_DISPATCH_REGISTRY)) {
      missingFromRegistry.push(method);
    }
  }
  for (const method of registryKeys) {
    if (!catalog.has(method)) {
      extraInRegistry.push(method);
    }
  }

  if (missingFromRegistry.length > 0 || extraInRegistry.length > 0) {
    const parts: string[] = [];
    if (missingFromRegistry.length > 0) {
      parts.push(`missing from registry: ${missingFromRegistry.join(", ")}`);
    }
    if (extraInRegistry.length > 0) {
      parts.push(`extra in registry: ${extraInRegistry.join(", ")}`);
    }
    throw new Error(`host wire domain registry coverage (#330): ${parts.join("; ")}`);
  }
}

assertDomainRegistryCoverage();

function handlersFromRegistry(
  runtime: ServiceDomainRuntime,
): DomainWireHandlerMap {
  const handlers: DomainWireHandlerMap = {};
  for (const method of Object.keys(
    DOMAIN_DISPATCH_REGISTRY,
  ) as DomainWireMethod[]) {
    const entry = DOMAIN_DISPATCH_REGISTRY[method];
    handlers[method] = async (params?: unknown) =>
      entry.handle(runtime, params);
  }
  return handlers;
}

/**
 * Host request entry: DomainRuntime in → framed dispatch out (#330).
 * Unknown methods return `undefined` (server maps to unknown_method).
 */
export function createDomainWireRequestHandler(
  runtime: ServiceDomainRuntime,
): (method: string, params?: unknown) => Promise<unknown | undefined> {
  assertHostPortWireCoverage(handlersFromRegistry(runtime));

  return async (method, params) => {
    const entry = DOMAIN_DISPATCH_REGISTRY[method as DomainWireMethod];
    if (!entry) {
      return undefined;
    }
    return entry.handle(runtime, params);
  };
}

/**
 * Thin map lookup for tests that inject a custom handler map.
 * Production host uses {@link createDomainWireRequestHandler}.
 */
export function createDomainWireDispatcher(
  handlers: DomainWireHandlerMap,
): (method: string, params?: unknown) => Promise<unknown | undefined> {
  return async (method, params) => {
    const handler = handlers[method];
    if (!handler) {
      return undefined;
    }
    return handler(params);
  };
}
