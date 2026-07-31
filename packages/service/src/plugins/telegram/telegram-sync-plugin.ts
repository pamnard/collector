/**
 * Telegram Path C SyncPlugin (#415 / #433).
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
  formatTelegramSyncError,
  isTelegramDownloadLimitError,
  type TelegramBotApi,
  type TelegramMessage,
} from "./telegram-bot-api.js";
import {
  TELEGRAM_BOT_TOKEN_KEY,
  TELEGRAM_PLUGIN_ID,
  expandRemoteIdToDeletes,
  flattenFolderPaths,
  loadTelegramPluginConfig,
  pendingAlbumKey,
  resolveTelegramDestinationFolder,
  saveTelegramPluginConfig,
  telegramRemoteId,
  type TelegramAlbumAckParts,
  type TelegramAwaitingDelete,
  type TelegramPendingAlbum,
  type TelegramPluginConfig,
} from "./telegram-config.js";
import {
  collectImportableMessages,
  listDownloadTargets,
  mapTelegramAlbumToItem,
  mapTelegramMessageToItem,
  nextTelegramCursor,
  parseTelegramCursor,
  selectAlbumsToClose,
} from "./telegram-map.js";

export interface TelegramSyncPluginDeps {
  credentials: CredentialsPort;
  fs: FileSystemAdapter;
  dataDir: string;
  resolveActiveVaultId: () => Promise<string>;
  listFolderTree: () => Promise<FolderTreeNode[]>;
  api?: TelegramBotApi;
}

async function loadMediaForMessages(
  api: TelegramBotApi,
  token: string,
  messages: TelegramMessage[],
  warnings: string[],
): Promise<Array<{ name: string; bytes: Uint8Array }>> {
  const media: Array<{ name: string; bytes: Uint8Array }> = [];
  const usedNames = new Set<string>();

  for (const message of messages) {
    for (const target of listDownloadTargets(message)) {
      try {
        const file = await api.getFile(token, target.fileId);
        if (!file.file_path) {
          throw new Error(`telegram: ${target.kind} file_path missing`);
        }
        const bytes = await api.downloadFile(
          token,
          file.file_path,
          file.file_size ?? target.fileSize,
        );
        let name =
          target.defaultName ||
          file.file_path.split("/").pop() ||
          `${target.kind}.bin`;
        if (usedNames.has(name)) {
          const stem = name.includes(".")
            ? name.slice(0, name.lastIndexOf("."))
            : name;
          const ext = name.includes(".")
            ? name.slice(name.lastIndexOf("."))
            : "";
          name = `${stem}-${message.message_id}${ext}`;
        }
        usedNames.add(name);
        media.push({ name, bytes });
      } catch (error) {
        if (isTelegramDownloadLimitError(error)) {
          warnings.push(
            `Файл пропущен: превышает лимит 20 МБ (${target.kind}, message ${message.message_id}).`,
          );
          continue;
        }
        throw error;
      }
    }
  }

  return media;
}

function awaitingKey(row: TelegramAwaitingDelete): string {
  return telegramRemoteId(row.chat_id, row.message_id);
}

function messageAwaiting(message: TelegramMessage, awaiting: Set<string>): boolean {
  return awaiting.has(telegramRemoteId(message.chat.id, message.message_id));
}

function mergeAlbumMessage(
  album: TelegramPendingAlbum,
  message: TelegramMessage,
): boolean {
  if (album.messages.some((m) => m.message_id === message.message_id)) {
    return false;
  }
  album.messages.push(message);
  album.messages.sort((a, b) => a.message_id - b.message_id);
  return true;
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

      try {
        await api.ensurePollingClearsWebhook(token);
      } catch (error) {
        throw new Error(formatTelegramSyncError(error));
      }

      let config = await flushAwaitingDeletes(token, vaultId, loaded);
      const resolved = await resolveFolder(vaultId, config);
      config = resolved.config;
      const { folderPath } = resolved;

      const awaiting = new Set(config.awaiting_delete.map(awaitingKey));
      const offset = parseTelegramCursor(cursor);

      let updates;
      try {
        updates = await api.getUpdates(token, { offset, timeout: 0 });
      } catch (error) {
        throw new Error(formatTelegramSyncError(error));
      }

      const importable = collectImportableMessages(updates).filter(
        (message) => !messageAwaiting(message, awaiting),
      );

      const pendingBeforeKeys = new Set(
        config.pending_albums.map((a) =>
          pendingAlbumKey(a.chat_id, a.media_group_id),
        ),
      );
      const albums = new Map<string, TelegramPendingAlbum>();
      for (const album of config.pending_albums) {
        albums.set(pendingAlbumKey(album.chat_id, album.media_group_id), {
          chat_id: album.chat_id,
          media_group_id: album.media_group_id,
          messages: [...album.messages],
        });
      }

      const touchedKeys = new Set<string>();
      const singles: TelegramMessage[] = [];
      const batchMessagesInOrder: TelegramMessage[] = [];

      for (const message of importable) {
        batchMessagesInOrder.push(message);
        const groupId = message.media_group_id?.trim();
        if (!groupId) {
          singles.push(message);
          continue;
        }
        const key = pendingAlbumKey(message.chat.id, groupId);
        let album = albums.get(key);
        if (!album) {
          album = {
            chat_id: message.chat.id,
            media_group_id: groupId,
            messages: [],
          };
          albums.set(key, album);
        }
        if (mergeAlbumMessage(album, message)) {
          touchedKeys.add(key);
        }
      }

      const toClose = new Set(
        selectAlbumsToClose({
          pendingBeforeKeys,
          albums,
          touchedKeys,
          batchMessagesInOrder,
        }),
      );

      const warnings: string[] = [];
      const items: NormalizedSyncItem[] = [];
      const albumAckParts: TelegramAlbumAckParts = {
        ...config.album_ack_parts,
      };

      for (const key of toClose) {
        const album = albums.get(key);
        if (!album || album.messages.length === 0) {
          albums.delete(key);
          continue;
        }
        const media = await loadMediaForMessages(
          api,
          token,
          album.messages,
          warnings,
        );
        const hasText = album.messages.some(
          (m) => (m.text ?? m.caption ?? "").trim().length > 0,
        );
        if (media.length === 0 && !hasText) {
          warnings.push(
            `Альбом пропущен: нет импортируемого содержимого (${album.media_group_id}).`,
          );
          albums.delete(key);
          continue;
        }
        const item = mapTelegramAlbumToItem(album.messages, folderPath, media);
        items.push(item);
        albumAckParts[item.remoteId] = album.messages.map((m) => ({
          chat_id: m.chat.id,
          message_id: m.message_id,
        }));
        albums.delete(key);
      }

      for (const message of singles) {
        const media = await loadMediaForMessages(
          api,
          token,
          [message],
          warnings,
        );
        const hasText = (message.text ?? message.caption ?? "").trim().length > 0;
        if (media.length === 0 && !hasText) {
          warnings.push(
            `Сообщение пропущено: нет импортируемого содержимого (${message.message_id}).`,
          );
          continue;
        }
        items.push(mapTelegramMessageToItem(message, folderPath, media));
      }

      const pending_albums = [...albums.values()];
      await saveTelegramPluginConfig(deps.fs, deps.dataDir, vaultId, {
        ...config,
        pending_albums,
        album_ack_parts: albumAckParts,
        last_pull_warnings: warnings,
      });

      if (warnings.length > 0) {
        console.warn("[telegram sync]", warnings.join(" | "));
      }

      const advanced = nextTelegramCursor(updates);
      return {
        items,
        nextCursor: advanced ?? cursor,
        ...(warnings.length > 0 ? { warnings } : {}),
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
      const nextAlbumAck = { ...config.album_ack_parts };

      for (const remoteId of remoteIds) {
        const rows = expandRemoteIdToDeletes(remoteId, config.album_ack_parts);
        for (const row of rows) {
          byKey.set(awaitingKey(row), row);
        }
        if (nextAlbumAck[remoteId]) {
          delete nextAlbumAck[remoteId];
        }
      }

      const queue = [...byKey.values()];
      await saveTelegramPluginConfig(deps.fs, deps.dataDir, vaultId, {
        ...config,
        awaiting_delete: queue,
        album_ack_parts: nextAlbumAck,
      });

      for (let i = 0; i < queue.length; i += 1) {
        const row = queue[i]!;
        try {
          await api.deleteMessage(token, row.chat_id, row.message_id);
        } catch (error) {
          await saveTelegramPluginConfig(deps.fs, deps.dataDir, vaultId, {
            ...config,
            awaiting_delete: queue.slice(i),
            album_ack_parts: nextAlbumAck,
          });
          throw error;
        }
      }

      await saveTelegramPluginConfig(deps.fs, deps.dataDir, vaultId, {
        ...config,
        awaiting_delete: [],
        album_ack_parts: nextAlbumAck,
      });
    },
  };
}
