/**
 * Telegram Path C SyncPlugin (#415).
 * pull → host handoff → ack(deleteMessage). Dedup via awaiting_delete ledger.
 */

import type {
  CredentialsPort,
  FolderTreeNode,
  NormalizedSyncItem,
  PullResult,
  SyncCursor,
  SyncPlugin,
} from "@collector/api";
import type { FileSystemAdapter } from "@collector/core";
import {
  createTelegramBotApi,
  type TelegramBotApi,
  type TelegramMessage,
} from "./telegram-bot-api.js";
import {
  TELEGRAM_BOT_TOKEN_KEY,
  TELEGRAM_PLUGIN_ID,
  flattenFolderPaths,
  loadTelegramPluginConfig,
  parseTelegramRemoteId,
  resolveTelegramDestinationFolder,
  saveTelegramPluginConfig,
  telegramRemoteId,
  type TelegramAwaitingDelete,
  type TelegramPluginConfig,
} from "./telegram-config.js";
import {
  collectImportableMessages,
  largestPhotoFileId,
  mapTelegramMessageToItem,
  nextTelegramCursor,
  parseTelegramCursor,
} from "./telegram-map.js";

export interface TelegramSyncPluginDeps {
  credentials: CredentialsPort;
  fs: FileSystemAdapter;
  dataDir: string;
  resolveActiveVaultId: () => Promise<string>;
  listFolderTree: () => Promise<FolderTreeNode[]>;
  api?: TelegramBotApi;
}

async function loadMediaForMessage(
  api: TelegramBotApi,
  token: string,
  message: TelegramMessage,
): Promise<Array<{ name: string; bytes: Uint8Array }>> {
  const media: Array<{ name: string; bytes: Uint8Array }> = [];

  const photoId = largestPhotoFileId(message);
  if (photoId) {
    const file = await api.getFile(token, photoId);
    if (!file.file_path) {
      throw new Error("telegram: photo file_path missing");
    }
    const bytes = await api.downloadFile(
      token,
      file.file_path,
      file.file_size,
    );
    const base = file.file_path.split("/").pop() || "photo.jpg";
    media.push({ name: base, bytes });
  }

  if (message.document) {
    const file = await api.getFile(token, message.document.file_id);
    if (!file.file_path) {
      throw new Error("telegram: document file_path missing");
    }
    const bytes = await api.downloadFile(
      token,
      file.file_path,
      file.file_size ?? message.document.file_size,
    );
    const name =
      message.document.file_name?.trim() ||
      file.file_path.split("/").pop() ||
      "document.bin";
    media.push({ name, bytes });
  }

  return media;
}

function awaitingKey(row: TelegramAwaitingDelete): string {
  return telegramRemoteId(row.chat_id, row.message_id);
}

export function createTelegramSyncPlugin(
  deps: TelegramSyncPluginDeps,
): SyncPlugin {
  const api = deps.api ?? createTelegramBotApi();

  const readToken = async (): Promise<string | null> =>
    deps.credentials.getCredential({
      pluginId: TELEGRAM_PLUGIN_ID,
      key: TELEGRAM_BOT_TOKEN_KEY,
    });

  const loadConfig = async (): Promise<{
    vaultId: string;
    config: TelegramPluginConfig;
  }> => {
    const vaultId = await deps.resolveActiveVaultId();
    const config = await loadTelegramPluginConfig(
      deps.fs,
      deps.dataDir,
      vaultId,
    );
    return { vaultId, config };
  };

  const resolveFolder = async (
    vaultId: string,
    config: TelegramPluginConfig,
  ): Promise<{ folderPath: string; config: TelegramPluginConfig }> => {
    const tree = await deps.listFolderTree();
    const folders = flattenFolderPaths(tree);
    const folderPath = resolveTelegramDestinationFolder(
      config.folder_path,
      folders,
    );
    if (folderPath !== config.folder_path) {
      const next = { ...config, folder_path: folderPath };
      await saveTelegramPluginConfig(deps.fs, deps.dataDir, vaultId, next);
      return { folderPath, config: next };
    }
    return { folderPath, config };
  };

  const flushAwaitingDeletes = async (
    token: string,
    vaultId: string,
    config: TelegramPluginConfig,
  ): Promise<TelegramPluginConfig> => {
    if (config.awaiting_delete.length === 0) {
      return config;
    }
    const remaining: TelegramAwaitingDelete[] = [];
    for (const row of config.awaiting_delete) {
      try {
        await api.deleteMessage(token, row.chat_id, row.message_id);
      } catch {
        remaining.push(row);
      }
    }
    if (remaining.length === config.awaiting_delete.length) {
      return config;
    }
    const next = { ...config, awaiting_delete: remaining };
    await saveTelegramPluginConfig(deps.fs, deps.dataDir, vaultId, next);
    return next;
  };

  return {
    id: TELEGRAM_PLUGIN_ID,

    async authenticate() {
      const token = await readToken();
      if (!token) {
        return;
      }
      const { config } = await loadConfig();
      if (!config.enabled) {
        return;
      }
      await api.getMe(token);
    },

    async pull(cursor: SyncCursor | null): Promise<PullResult> {
      const token = await readToken();
      const { vaultId, config: loaded } = await loadConfig();

      if (!token || !loaded.enabled) {
        return { items: [], nextCursor: cursor };
      }

      let config = await flushAwaitingDeletes(token, vaultId, loaded);
      const resolved = await resolveFolder(vaultId, config);
      config = resolved.config;
      const { folderPath } = resolved;

      const awaiting = new Set(config.awaiting_delete.map(awaitingKey));
      const offset = parseTelegramCursor(cursor);
      const updates = await api.getUpdates(token, { offset, timeout: 0 });
      const messages = collectImportableMessages(updates).filter((message) => {
        const id = telegramRemoteId(message.chat.id, message.message_id);
        return !awaiting.has(id);
      });

      const items: NormalizedSyncItem[] = [];
      for (const message of messages) {
        const media = await loadMediaForMessage(api, token, message);
        items.push(mapTelegramMessageToItem(message, folderPath, media));
      }

      const advanced = nextTelegramCursor(updates);
      return {
        items,
        nextCursor: advanced ?? cursor,
      };
    },

    async ack(remoteIds: string[]) {
      if (remoteIds.length === 0) {
        return;
      }
      const token = await readToken();
      if (!token) {
        throw new Error("telegram: bot token missing for ack");
      }
      const { vaultId, config } = await loadConfig();
      const byKey = new Map(
        config.awaiting_delete.map((row) => [awaitingKey(row), row]),
      );
      for (const remoteId of remoteIds) {
        const parsed = parseTelegramRemoteId(remoteId);
        byKey.set(awaitingKey(parsed), parsed);
      }
      const queue = [...byKey.values()];
      await saveTelegramPluginConfig(deps.fs, deps.dataDir, vaultId, {
        ...config,
        awaiting_delete: queue,
      });

      for (let i = 0; i < queue.length; i += 1) {
        const row = queue[i]!;
        try {
          await api.deleteMessage(token, row.chat_id, row.message_id);
        } catch (error) {
          await saveTelegramPluginConfig(deps.fs, deps.dataDir, vaultId, {
            ...config,
            awaiting_delete: queue.slice(i),
          });
          throw error;
        }
      }

      await saveTelegramPluginConfig(deps.fs, deps.dataDir, vaultId, {
        ...config,
        awaiting_delete: [],
      });
    },
  };
}
