import { describe, expect, it, vi } from "vitest";
import { NodeFileSystemAdapter } from "@collector/core/node";
import {
  createMemoryKeychainBackend,
  createCredentialsService,
} from "../../credentials.js";
import { TelegramBotApiError } from "./telegram-bot-api.js";
import {
  loadTelegramPluginConfig,
  saveTelegramPluginConfig,
  TELEGRAM_PLUGIN_ID,
} from "./telegram-config.js";
import { createTelegramSyncPlugin } from "./telegram-sync-plugin.js";
import {
  baseConfig,
  mockApi,
  tempDataDir,
} from "./telegram-test-harness.js";

describe("createTelegramSyncPlugin pull (#415 / #433 / #922)", () => {
  it("disabled / missing token is a quiet no-op pull", async () => {
    const dataDir = await tempDataDir();
    const fs = new NodeFileSystemAdapter();
    const credentials = createCredentialsService({
      backend: createMemoryKeychainBackend(),
    });
    const api = mockApi({
      getUpdates: vi.fn(),
    });

    const plugin = createTelegramSyncPlugin({
      credentials,
      fs,
      dataDir,
      resolveActiveVaultId: async () => "v1",
      listFolderTree: async () => [
        { name: "Inbox", path: "Inbox", item_count: 0, children: [] },
      ],
      api,
    });

    await expect(plugin.pull(null)).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(api.getUpdates).not.toHaveBeenCalled();
  });

  it("clears webhook before getUpdates when url is set", async () => {
    const dataDir = await tempDataDir();
    const fs = new NodeFileSystemAdapter();
    const credentials = createCredentialsService({
      backend: createMemoryKeychainBackend(),
    });
    await credentials.setCredential({
      pluginId: TELEGRAM_PLUGIN_ID,
      key: "bot_token",
      secret: "tok",
    });
    await saveTelegramPluginConfig(fs, dataDir, "v1", baseConfig());

    const order: string[] = [];
    const api = mockApi({
      ensurePollingClearsWebhook: vi.fn(async () => {
        order.push("webhook");
        return true;
      }),
      getUpdates: vi.fn(async () => {
        order.push("updates");
        return [];
      }),
    });

    const plugin = createTelegramSyncPlugin({
      credentials,
      fs,
      dataDir,
      resolveActiveVaultId: async () => "v1",
      listFolderTree: async () => [
        { name: "Inbox", path: "Inbox", item_count: 0, children: [] },
      ],
      api,
    });

    await plugin.pull(null);
    expect(order).toEqual(["webhook", "updates"]);
  });

  it("imports video-only and video+caption", async () => {
    const dataDir = await tempDataDir();
    const fs = new NodeFileSystemAdapter();
    const credentials = createCredentialsService({
      backend: createMemoryKeychainBackend(),
    });
    await credentials.setCredential({
      pluginId: TELEGRAM_PLUGIN_ID,
      key: "bot_token",
      secret: "tok",
    });
    await saveTelegramPluginConfig(fs, dataDir, "v1", baseConfig());

    const api = mockApi({
      getUpdates: vi.fn(async () => [
        {
          update_id: 1,
          message: {
            message_id: 10,
            date: 1,
            chat: { id: 100, type: "private" },
            video: {
              file_id: "vid1",
              file_unique_id: "u1",
              file_size: 4,
            },
          },
        },
        {
          update_id: 2,
          message: {
            message_id: 11,
            date: 1,
            chat: { id: 100, type: "private" },
            caption: "cap",
            video: {
              file_id: "vid2",
              file_unique_id: "u2",
              file_size: 4,
            },
          },
        },
      ]),
      getFile: vi.fn(async (_t: string, fileId: string) => ({
        file_id: fileId,
        file_unique_id: fileId,
        file_path: `videos/${fileId}.mp4`,
        file_size: 4,
      })),
      downloadFile: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    });

    const plugin = createTelegramSyncPlugin({
      credentials,
      fs,
      dataDir,
      resolveActiveVaultId: async () => "v1",
      listFolderTree: async () => [
        { name: "Inbox", path: "Inbox", item_count: 0, children: [] },
      ],
      api,
    });

    const pulled = await plugin.pull(null);
    expect(pulled.items).toHaveLength(2);
    expect(pulled.items[0]?.title).toBe("Telegram video");
    expect(pulled.items[0]?.media).toHaveLength(1);
    expect(pulled.items[1]?.title).toBe("cap");
    expect(pulled.items[1]?.body).toBe("cap");
    expect(pulled.items[1]?.media).toHaveLength(1);
  });

  it("oversized file is skipped with warning; pull continues", async () => {
    const dataDir = await tempDataDir();
    const fs = new NodeFileSystemAdapter();
    const credentials = createCredentialsService({
      backend: createMemoryKeychainBackend(),
    });
    await credentials.setCredential({
      pluginId: TELEGRAM_PLUGIN_ID,
      key: "bot_token",
      secret: "tok",
    });
    await saveTelegramPluginConfig(fs, dataDir, "v1", baseConfig());

    const api = mockApi({
      getUpdates: vi.fn(async () => [
        {
          update_id: 1,
          message: {
            message_id: 1,
            date: 1,
            chat: { id: 100, type: "private" },
            text: "ok text",
          },
        },
        {
          update_id: 2,
          message: {
            message_id: 2,
            date: 1,
            chat: { id: 100, type: "private" },
            video: {
              file_id: "huge",
              file_unique_id: "uh",
              file_size: 30 * 1024 * 1024,
            },
          },
        },
      ]),
      getFile: vi.fn(async () => ({
        file_id: "huge",
        file_unique_id: "uh",
        file_path: "videos/huge.mp4",
        file_size: 30 * 1024 * 1024,
      })),
      downloadFile: vi.fn(async () => {
        throw new TelegramBotApiError(
          "telegram: file exceeds download limit (31457280 > 20971520)",
        );
      }),
    });

    const plugin = createTelegramSyncPlugin({
      credentials,
      fs,
      dataDir,
      resolveActiveVaultId: async () => "v1",
      listFolderTree: async () => [
        { name: "Inbox", path: "Inbox", item_count: 0, children: [] },
      ],
      api,
    });

    const pulled = await plugin.pull(null);
    expect(pulled.items).toHaveLength(1);
    expect(pulled.items[0]?.remoteId).toBe("100:1");
    expect(pulled.warnings?.some((w) => /20 МБ/.test(w))).toBe(true);
    const cfg = await loadTelegramPluginConfig(fs, dataDir, "v1");
    expect(cfg.last_pull_warnings.length).toBeGreaterThan(0);
  });
});
