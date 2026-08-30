import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { NodeFileSystemAdapter } from "@collector/core/node";
import {
  createMemoryKeychainBackend,
  createCredentialsService,
} from "../../credentials.js";
import type { TelegramBotApi } from "./telegram-bot-api.js";
import {
  loadTelegramPluginConfig,
  saveTelegramPluginConfig,
  TELEGRAM_CONFIG_DIR,
  TELEGRAM_PLUGIN_ID,
} from "./telegram-config.js";
import {
  createTelegramSyncPlugin,
  TELEGRAM_DELETE_CONCURRENCY,
} from "./telegram-sync-plugin.js";
import {
  baseConfig,
  mockApi,
  tempDataDir,
} from "./telegram-test-harness.js";

describe("createTelegramSyncPlugin flush-deletes (#415 / #922)", () => {
  async function pluginForFlush(
    dataDir: string,
    fs: NodeFileSystemAdapter,
    api: TelegramBotApi,
  ) {
    const credentials = createCredentialsService({
      backend: createMemoryKeychainBackend(),
    });
    await credentials.setCredential({
      pluginId: TELEGRAM_PLUGIN_ID,
      key: "bot_token",
      secret: "tok",
    });
    return createTelegramSyncPlugin({
      credentials,
      fs,
      dataDir,
      resolveActiveVaultId: async () => "v1",
      listFolderTree: async () => [
        { name: "Inbox", path: "Inbox", item_count: 0, children: [] },
      ],
      api,
    });
  }

  function trackingDeleteMessage(
    decide: (messageId: number) => void = () => undefined,
  ) {
    let inFlight = 0;
    let peakInFlight = 0;
    const deleteMessage = vi.fn(
      async (_token: string, _chatId: number, messageId: number) => {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 40));
        inFlight -= 1;
        decide(messageId);
        return true as const;
      },
    );
    return {
      deleteMessage,
      peak: () => peakInFlight,
    };
  }

  it("flushAwaitingDeletes is bounded-parallel (peak in-flight > 1)", async () => {
    const dataDir = await tempDataDir();
    const fs = new NodeFileSystemAdapter();
    const rows = [
      { chat_id: 100, message_id: 1 },
      { chat_id: 100, message_id: 2 },
      { chat_id: 100, message_id: 3 },
    ];
    await saveTelegramPluginConfig(
      fs,
      dataDir,
      "v1",
      baseConfig({ awaiting_delete: rows }),
    );

    const { deleteMessage, peak } = trackingDeleteMessage();
    const plugin = await pluginForFlush(
      dataDir,
      fs,
      mockApi({
        getUpdates: vi.fn(async () => []),
        deleteMessage,
      }),
    );

    await plugin.pull(null);

    expect(deleteMessage).toHaveBeenCalledTimes(3);
    expect(peak()).toBeGreaterThan(1);
    expect(peak()).toBeLessThanOrEqual(TELEGRAM_DELETE_CONCURRENCY);
    const cfg = await loadTelegramPluginConfig(fs, dataDir, "v1");
    expect(cfg.awaiting_delete).toEqual([]);
  });

  it("flushAwaitingDeletes keeps failures under concurrency; drops successes", async () => {
    const dataDir = await tempDataDir();
    const fs = new NodeFileSystemAdapter();
    const rows = [
      { chat_id: 100, message_id: 1 },
      { chat_id: 100, message_id: 2 },
      { chat_id: 100, message_id: 3 },
      { chat_id: 100, message_id: 4 },
    ];
    await saveTelegramPluginConfig(
      fs,
      dataDir,
      "v1",
      baseConfig({ awaiting_delete: rows }),
    );

    const { deleteMessage, peak } = trackingDeleteMessage((messageId) => {
      if (messageId % 2 === 0) {
        throw new Error(`delete failed for ${messageId}`);
      }
    });
    const plugin = await pluginForFlush(
      dataDir,
      fs,
      mockApi({
        getUpdates: vi.fn(async () => []),
        deleteMessage,
      }),
    );

    await plugin.pull(null);

    expect(peak()).toBeGreaterThan(1);
    expect(peak()).toBeLessThanOrEqual(TELEGRAM_DELETE_CONCURRENCY);
    const cfg = await loadTelegramPluginConfig(fs, dataDir, "v1");
    expect(cfg.awaiting_delete).toEqual([
      { chat_id: 100, message_id: 2 },
      { chat_id: 100, message_id: 4 },
    ]);
  });

  it("flushAwaitingDeletes all-failure leaves awaiting_delete and skips flush persist", async () => {
    const dataDir = await tempDataDir();
    const fs = new NodeFileSystemAdapter();
    const rows = [
      { chat_id: 100, message_id: 1 },
      { chat_id: 100, message_id: 2 },
    ];
    await saveTelegramPluginConfig(
      fs,
      dataDir,
      "v1",
      baseConfig({ awaiting_delete: rows }),
    );

    const configPath = join(dataDir, TELEGRAM_CONFIG_DIR, "v1.json");
    const before = await fs.readText(configPath);
    let configWrites = 0;
    const writeText = fs.writeText.bind(fs);
    fs.writeText = async (path, content) => {
      if (path === configPath) {
        configWrites += 1;
      }
      return writeText(path, content);
    };

    const deleteMessage = vi.fn(async () => {
      throw new Error("delete failed");
    });
    const plugin = await pluginForFlush(
      dataDir,
      fs,
      mockApi({
        getUpdates: vi.fn(async () => []),
        deleteMessage,
      }),
    );

    await plugin.pull(null);

    expect(deleteMessage).toHaveBeenCalledTimes(2);
    const cfg = await loadTelegramPluginConfig(fs, dataDir, "v1");
    expect(cfg.awaiting_delete).toEqual(rows);
    // flush early-exits without persist; pull still writes once at end
    expect(configWrites).toBe(1);
    const after = await fs.readText(configPath);
    expect(JSON.parse(after).awaiting_delete).toEqual(
      JSON.parse(before).awaiting_delete,
    );
  });
});
