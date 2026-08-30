import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, vi } from "vitest";
import type { TelegramBotApi } from "./telegram-bot-api.js";
import type { TelegramPluginConfig } from "./telegram-config.js";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

export async function tempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "collector-tg-"));
  dirs.push(dir);
  return dir;
}

export function baseConfig(
  patch: Partial<TelegramPluginConfig> = {},
): TelegramPluginConfig {
  return {
    schema_version: 1,
    enabled: true,
    folder_path: "Inbox",
    bot_username: "bot",
    last_sync_at: null,
    awaiting_delete: [],
    imported: [],
    sync_interval_ms: 300_000,
    pending_albums: [],
    album_ack_parts: {},
    last_pull_warnings: [],
    ...patch,
  };
}

export function mockApi(overrides: Partial<TelegramBotApi> = {}): TelegramBotApi {
  return {
    getMe: vi.fn(async () => ({
      id: 1,
      is_bot: true,
      first_name: "B",
      username: "bot",
    })),
    getWebhookInfo: vi.fn(async () => ({ url: "" })),
    deleteWebhook: vi.fn(async () => true as const),
    ensurePollingClearsWebhook: vi.fn(async () => false),
    getUpdates: vi.fn(async () => []),
    deleteMessage: vi.fn(async () => true as const),
    getFile: vi.fn(),
    downloadFile: vi.fn(),
    ...overrides,
  } as TelegramBotApi;
}
