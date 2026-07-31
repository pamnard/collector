/**
 * Telegram Path C settings service (#415).
 */

import type {
  FolderTreeNode,
  TelegramBotIdentity,
  TelegramSyncPort,
  TelegramSyncSettings,
  TelegramSyncSettingsPatch,
} from "@collector/api";
import type { FileSystemAdapter } from "@collector/core";
import { createTelegramBotApi, type TelegramBotApi } from "./telegram-bot-api.js";
import {
  flattenFolderPaths,
  loadTelegramPluginConfig,
  toTelegramSyncSettings,
  updateTelegramPluginConfig,
} from "./telegram-config.js";

export interface TelegramSyncServiceDeps {
  fs: FileSystemAdapter;
  dataDir: string;
  resolveActiveVaultId: () => Promise<string>;
  listFolderTree: () => Promise<FolderTreeNode[]>;
  api?: TelegramBotApi;
}

export function createTelegramSyncService(
  deps: TelegramSyncServiceDeps,
): TelegramSyncPort {
  const api = deps.api ?? createTelegramBotApi();

  return {
    async getTelegramSyncSettings(): Promise<TelegramSyncSettings> {
      const vaultId = await deps.resolveActiveVaultId();
      const tree = await deps.listFolderTree();
      const folders = flattenFolderPaths(tree);
      const config = await updateTelegramPluginConfig(
        deps.fs,
        deps.dataDir,
        vaultId,
        {},
        folders,
      );
      return toTelegramSyncSettings(config);
    },

    async updateTelegramSyncSettings(
      patch: TelegramSyncSettingsPatch,
    ): Promise<TelegramSyncSettings> {
      const vaultId = await deps.resolveActiveVaultId();
      const tree = await deps.listFolderTree();
      const folders = flattenFolderPaths(tree);
      const config = await updateTelegramPluginConfig(
        deps.fs,
        deps.dataDir,
        vaultId,
        patch,
        folders,
      );
      return toTelegramSyncSettings(config);
    },

    async validateTelegramBotToken(input: {
      token: string;
    }): Promise<TelegramBotIdentity> {
      const token = input.token.trim();
      if (!token) {
        throw new Error("telegram: bot token required");
      }
      const me = await api.getMe(token);
      return {
        id: me.id,
        username: me.username ?? null,
        first_name: me.first_name,
      };
    },
  };
}

/** Mark last_sync_at after a successful syncNow for telegram. */
export async function markTelegramLastSyncAt(
  deps: Pick<
    TelegramSyncServiceDeps,
    "fs" | "dataDir" | "resolveActiveVaultId"
  >,
): Promise<void> {
  const vaultId = await deps.resolveActiveVaultId();
  await updateTelegramPluginConfig(deps.fs, deps.dataDir, vaultId, {
    last_sync_at: new Date().toISOString(),
  });
}

export async function loadRawTelegramConfig(
  deps: Pick<
    TelegramSyncServiceDeps,
    "fs" | "dataDir" | "resolveActiveVaultId"
  >,
) {
  const vaultId = await deps.resolveActiveVaultId();
  return loadTelegramPluginConfig(deps.fs, deps.dataDir, vaultId);
}
