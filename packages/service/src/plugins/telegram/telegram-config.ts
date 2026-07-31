/**
 * Per-vault Telegram plugin config (#415).
 * Non-secret settings + awaiting_delete ledger. Token stays in keychain.
 */

import type { FileSystemAdapter } from "@collector/core";
import { INBOX_FOLDER_NAME } from "@collector/shared";

export const TELEGRAM_PLUGIN_ID = "telegram";
export const TELEGRAM_BOT_TOKEN_KEY = "bot_token";
export const TELEGRAM_CONFIG_DIR = "sync-plugins/telegram";

export interface TelegramAwaitingDelete {
  chat_id: number;
  message_id: number;
}

export interface TelegramPluginConfig {
  schema_version: 1;
  enabled: boolean;
  folder_path: string;
  bot_username: string | null;
  last_sync_at: string | null;
  awaiting_delete: TelegramAwaitingDelete[];
}

export interface TelegramSyncSettings {
  enabled: boolean;
  folder_path: string;
  bot_username: string | null;
  last_sync_at: string | null;
}

export type TelegramSyncSettingsPatch = Partial<{
  enabled: boolean;
  folder_path: string;
  bot_username: string | null;
  last_sync_at: string | null;
}>;

export function defaultTelegramPluginConfig(): TelegramPluginConfig {
  return {
    schema_version: 1,
    enabled: false,
    folder_path: INBOX_FOLDER_NAME,
    bot_username: null,
    last_sync_at: null,
    awaiting_delete: [],
  };
}

export function toTelegramSyncSettings(
  config: TelegramPluginConfig,
): TelegramSyncSettings {
  return {
    enabled: config.enabled,
    folder_path: config.folder_path,
    bot_username: config.bot_username,
    last_sync_at: config.last_sync_at,
  };
}

export function telegramRemoteId(chatId: number, messageId: number): string {
  return `${chatId}:${messageId}`;
}

export function parseTelegramRemoteId(
  remoteId: string,
): TelegramAwaitingDelete {
  const sep = remoteId.lastIndexOf(":");
  if (sep <= 0 || sep === remoteId.length - 1) {
    throw new Error(`telegram: invalid remoteId ${remoteId}`);
  }
  const chat_id = Number(remoteId.slice(0, sep));
  const message_id = Number(remoteId.slice(sep + 1));
  if (!Number.isFinite(chat_id) || !Number.isFinite(message_id)) {
    throw new Error(`telegram: invalid remoteId ${remoteId}`);
  }
  return { chat_id, message_id };
}

export function flattenFolderPaths(
  nodes: Array<{ path: string; children?: unknown }>,
): string[] {
  const out: string[] = [];
  const walk = (list: Array<{ path: string; children?: unknown }>) => {
    for (const node of list) {
      if (typeof node.path === "string" && node.path) {
        out.push(node.path);
      }
      const children = node.children;
      if (Array.isArray(children)) {
        walk(children as Array<{ path: string; children?: unknown }>);
      }
    }
  };
  walk(nodes);
  return out;
}

export function resolveTelegramDestinationFolder(
  folderPath: string | null | undefined,
  existingFolders: readonly string[],
): string {
  const trimmed = folderPath?.trim() ?? "";
  if (!trimmed) {
    return INBOX_FOLDER_NAME;
  }
  const match = existingFolders.find(
    (path) => path.toLowerCase() === trimmed.toLowerCase(),
  );
  if (!match) {
    return INBOX_FOLDER_NAME;
  }
  return match;
}

function configPath(fs: FileSystemAdapter, dataDir: string, vaultId: string): string {
  return fs.join(dataDir, TELEGRAM_CONFIG_DIR, `${vaultId}.json`);
}

export async function loadTelegramPluginConfig(
  fs: FileSystemAdapter,
  dataDir: string,
  vaultId: string,
): Promise<TelegramPluginConfig> {
  const path = configPath(fs, dataDir, vaultId);
  if (!(await fs.exists(path))) {
    return defaultTelegramPluginConfig();
  }
  const raw = JSON.parse(await fs.readText(path)) as TelegramPluginConfig;
  if (raw.schema_version !== 1 || typeof raw !== "object" || !raw) {
    throw new Error(`telegram config corrupt at ${path}: expected schema_version 1`);
  }
  return {
    schema_version: 1,
    enabled: Boolean(raw.enabled),
    folder_path:
      typeof raw.folder_path === "string" && raw.folder_path.trim()
        ? raw.folder_path.trim()
        : INBOX_FOLDER_NAME,
    bot_username:
      typeof raw.bot_username === "string" && raw.bot_username.trim()
        ? raw.bot_username.trim()
        : null,
    last_sync_at:
      typeof raw.last_sync_at === "string" && raw.last_sync_at.trim()
        ? raw.last_sync_at
        : null,
    awaiting_delete: Array.isArray(raw.awaiting_delete)
      ? raw.awaiting_delete.filter(
          (row): row is TelegramAwaitingDelete =>
            !!row &&
            typeof row === "object" &&
            typeof row.chat_id === "number" &&
            typeof row.message_id === "number",
        )
      : [],
  };
}

export async function saveTelegramPluginConfig(
  fs: FileSystemAdapter,
  dataDir: string,
  vaultId: string,
  config: TelegramPluginConfig,
): Promise<void> {
  const dir = fs.join(dataDir, TELEGRAM_CONFIG_DIR);
  await fs.mkdir(dir);
  const path = configPath(fs, dataDir, vaultId);
  await fs.writeText(path, `${JSON.stringify(config, null, 2)}\n`);
}

export async function updateTelegramPluginConfig(
  fs: FileSystemAdapter,
  dataDir: string,
  vaultId: string,
  patch: TelegramSyncSettingsPatch & {
    awaiting_delete?: TelegramAwaitingDelete[];
  },
  existingFolders?: readonly string[],
): Promise<TelegramPluginConfig> {
  const current = await loadTelegramPluginConfig(fs, dataDir, vaultId);
  const next: TelegramPluginConfig = {
    ...current,
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.bot_username !== undefined
      ? { bot_username: patch.bot_username }
      : {}),
    ...(patch.last_sync_at !== undefined
      ? { last_sync_at: patch.last_sync_at }
      : {}),
    ...(patch.awaiting_delete !== undefined
      ? { awaiting_delete: patch.awaiting_delete }
      : {}),
  };

  if (patch.folder_path !== undefined || existingFolders) {
    const candidate =
      patch.folder_path !== undefined ? patch.folder_path : next.folder_path;
    next.folder_path = resolveTelegramDestinationFolder(
      candidate,
      existingFolders ?? [next.folder_path, INBOX_FOLDER_NAME],
    );
  }

  await saveTelegramPluginConfig(fs, dataDir, vaultId, next);
  return next;
}
