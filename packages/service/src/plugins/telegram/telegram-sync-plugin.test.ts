import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeFileSystemAdapter } from "@collector/core/node";
import { INBOX_FOLDER_NAME } from "@collector/shared";
import { createMemoryKeychainBackend, createCredentialsService } from "../../credentials.js";
import { createSyncPluginRegistry } from "../../sync-plugin-registry.js";
import {
  flattenFolderPaths,
  loadTelegramPluginConfig,
  resolveTelegramDestinationFolder,
  saveTelegramPluginConfig,
  updateTelegramPluginConfig,
} from "./telegram-config.js";
import { deriveTelegramTitle, mapTelegramMessageToItem } from "./telegram-map.js";
import { createTelegramSyncPlugin } from "./telegram-sync-plugin.js";
import type { TelegramBotApi } from "./telegram-bot-api.js";
import { TELEGRAM_PLUGIN_ID } from "./telegram-config.js";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function tempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "collector-tg-"));
  dirs.push(dir);
  return dir;
}

describe("telegram-config / map (#415)", () => {
  it("resolveTelegramDestinationFolder falls back to Inbox", () => {
    expect(
      resolveTelegramDestinationFolder("Missing", ["Inbox", "Work"]),
    ).toBe(INBOX_FOLDER_NAME);
    expect(resolveTelegramDestinationFolder("Work", ["Inbox", "Work"])).toBe(
      "Work",
    );
    expect(resolveTelegramDestinationFolder("", ["Inbox"])).toBe(
      INBOX_FOLDER_NAME,
    );
  });

  it("flattenFolderPaths walks tree", () => {
    expect(
      flattenFolderPaths([
        { path: "Inbox", children: [] },
        {
          path: "A",
          children: [{ path: "A/B", children: [] }],
        },
      ]),
    ).toEqual(["Inbox", "A", "A/B"]);
  });

  it("deriveTelegramTitle and map omit sourceRef", () => {
    expect(
      deriveTelegramTitle({
        message_id: 1,
        date: 0,
        chat: { id: 1, type: "private" },
        text: "Hello\nworld",
      }),
    ).toBe("Hello");
    const item = mapTelegramMessageToItem(
      {
        message_id: 2,
        date: 0,
        chat: { id: 9, type: "private" },
        text: "body",
      },
      "Inbox",
    );
    expect(item.remoteId).toBe("9:2");
    expect(item.sourceRef).toBeUndefined();
    expect(item.folder_path).toBe("Inbox");
  });

  it("load/save/update config persists awaiting_delete and snaps folder", async () => {
    const dataDir = await tempDataDir();
    const fs = new NodeFileSystemAdapter();
    await saveTelegramPluginConfig(fs, dataDir, "v1", {
      schema_version: 1,
      enabled: true,
      folder_path: "Gone",
      bot_username: "bot",
      last_sync_at: null,
      awaiting_delete: [{ chat_id: 1, message_id: 2 }],
    });
    const updated = await updateTelegramPluginConfig(
      fs,
      dataDir,
      "v1",
      {},
      ["Inbox", "Work"],
    );
    expect(updated.folder_path).toBe(INBOX_FOLDER_NAME);
    expect(updated.awaiting_delete).toEqual([{ chat_id: 1, message_id: 2 }]);
    const loaded = await loadTelegramPluginConfig(fs, dataDir, "v1");
    expect(loaded.enabled).toBe(true);
    expect(loaded.bot_username).toBe("bot");
  });
});

describe("createTelegramSyncPlugin (#415)", () => {
  it("disabled / missing token is a quiet no-op pull", async () => {
    const dataDir = await tempDataDir();
    const fs = new NodeFileSystemAdapter();
    const credentials = createCredentialsService({
      backend: createMemoryKeychainBackend(),
    });
    const api = {
      getMe: vi.fn(),
      getUpdates: vi.fn(),
      deleteMessage: vi.fn(),
      getFile: vi.fn(),
      downloadFile: vi.fn(),
    } as unknown as TelegramBotApi;

    const plugin = createTelegramSyncPlugin({
      credentials,
      fs,
      dataDir,
      resolveActiveVaultId: async () => "v1",
      listFolderTree: async () => [{ name: "Inbox", path: "Inbox", item_count: 0, children: [] }],
      api,
    });

    await expect(plugin.pull(null)).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(api.getUpdates).not.toHaveBeenCalled();
  });

  it("pull → import → ack deletes; awaiting_delete skips re-import", async () => {
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
    await saveTelegramPluginConfig(fs, dataDir, "v1", {
      schema_version: 1,
      enabled: true,
      folder_path: "Inbox",
      bot_username: "bot",
      last_sync_at: null,
      awaiting_delete: [],
    });

    const deleteMessage = vi.fn(async () => true as const);
    const api = {
      getMe: vi.fn(async () => ({
        id: 1,
        is_bot: true,
        first_name: "B",
        username: "bot",
      })),
      getUpdates: vi.fn(async () => [
        {
          update_id: 10,
          message: {
            message_id: 5,
            date: 1,
            chat: { id: 100, type: "private" },
            text: "hello",
          },
        },
      ]),
      deleteMessage,
      getFile: vi.fn(),
      downloadFile: vi.fn(),
    } as unknown as TelegramBotApi;

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

    const createItem = vi.fn(async (input: { title: string }) => ({
      id: `Inbox/${input.title}.md`,
      title: input.title,
    }));
    const registry = createSyncPluginRegistry({
      fs,
      dataDir,
      resolveActiveVaultId: async () => "v1",
      createItem: createItem as never,
      attachMediaFiles: vi.fn(async () => []),
      createCatalog: () => [plugin],
    });

    const first = await registry.syncNow(TELEGRAM_PLUGIN_ID);
    expect(first.importedCount).toBe(1);
    expect(deleteMessage).toHaveBeenCalledWith("tok", 100, 5);
    expect(createItem).toHaveBeenCalledTimes(1);

    // Simulate delete residue: keep awaiting_delete and fail further deletes.
    deleteMessage.mockImplementation(async () => {
      throw new Error("delete still failing");
    });
    await saveTelegramPluginConfig(fs, dataDir, "v1", {
      ...(await loadTelegramPluginConfig(fs, dataDir, "v1")),
      awaiting_delete: [{ chat_id: 100, message_id: 5 }],
    });
    await fs.writeText(
      join(dataDir, "sync-plugins", "v1.json"),
      `${JSON.stringify({ schema_version: 1, cursors: { telegram: null } }, null, 2)}\n`,
    );

    const second = await registry.syncNow(TELEGRAM_PLUGIN_ID);
    expect(second.importedCount).toBe(0);
    expect(createItem).toHaveBeenCalledTimes(1);
    expect(deleteMessage.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("ack failure keeps awaiting_delete and does not clear ledger", async () => {
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
    await saveTelegramPluginConfig(fs, dataDir, "v1", {
      schema_version: 1,
      enabled: true,
      folder_path: "Inbox",
      bot_username: "bot",
      last_sync_at: null,
      awaiting_delete: [],
    });

    const api = {
      getMe: vi.fn(async () => ({ id: 1, is_bot: true, first_name: "B" })),
      getUpdates: vi.fn(async () => [
        {
          update_id: 1,
          message: {
            message_id: 9,
            date: 1,
            chat: { id: 3, type: "private" },
            text: "x",
          },
        },
      ]),
      deleteMessage: vi.fn(async () => {
        throw new Error("delete failed");
      }),
      getFile: vi.fn(),
      downloadFile: vi.fn(),
    } as unknown as TelegramBotApi;

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

    const registry = createSyncPluginRegistry({
      fs,
      dataDir,
      resolveActiveVaultId: async () => "v1",
      createItem: vi.fn(async (input: { title: string }) => ({
        id: `Inbox/${input.title}.md`,
        title: input.title,
      })) as never,
      attachMediaFiles: vi.fn(async () => []),
      createCatalog: () => [plugin],
    });

    await expect(registry.syncNow(TELEGRAM_PLUGIN_ID)).rejects.toThrow(
      /delete failed/,
    );
    const cfg = await loadTelegramPluginConfig(fs, dataDir, "v1");
    expect(cfg.awaiting_delete).toEqual([{ chat_id: 3, message_id: 9 }]);
  });
});
