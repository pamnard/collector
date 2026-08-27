import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeFileSystemAdapter } from "@collector/core/node";
import { INBOX_FOLDER_NAME } from "@collector/shared";
import {
  createMemoryKeychainBackend,
  createCredentialsService,
} from "../../credentials.js";
import { createSyncPluginRegistry } from "../../sync-plugin-registry.js";
import {
  TelegramBotApiError,
  type TelegramBotApi,
} from "./telegram-bot-api.js";
import {
  flattenFolderPaths,
  loadTelegramPluginConfig,
  resolveTelegramDestinationFolder,
  saveTelegramPluginConfig,
  TELEGRAM_PLUGIN_ID,
  updateTelegramPluginConfig,
  type TelegramPluginConfig,
} from "./telegram-config.js";
import {
  deriveTelegramTitle,
  mapTelegramMessageToItem,
  messageHasImportableContent,
  selectAlbumsToClose,
} from "./telegram-map.js";
import { createTelegramSyncPlugin } from "./telegram-sync-plugin.js";

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

function baseConfig(
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

function mockApi(overrides: Partial<TelegramBotApi> = {}): TelegramBotApi {
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

describe("telegram-config / map (#415 / #433)", () => {
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
    expect(
      messageHasImportableContent({
        message_id: 1,
        date: 0,
        chat: { id: 1, type: "private" },
        video: { file_id: "v", file_unique_id: "u" },
      }),
    ).toBe(true);
    expect(
      deriveTelegramTitle({
        message_id: 1,
        date: 0,
        chat: { id: 1, type: "private" },
        video: { file_id: "v", file_unique_id: "u" },
      }),
    ).toBe("Telegram video");
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

  it("mapTelegramMessageToItem preserves text_link as markdown body; title stays plain", () => {
    const item = mapTelegramMessageToItem(
      {
        message_id: 3,
        date: 0,
        chat: { id: 9, type: "private" },
        text: "Try Product today",
        entities: [
          {
            type: "text_link",
            offset: 4,
            length: 7,
            url: "https://example.com/p",
          },
        ],
      },
      "Inbox",
    );
    expect(item.body).toBe("Try [Product](https://example.com/p) today");
    expect(item.title).toBe("Try Product today");
  });

  it("selectAlbumsToClose settles idle pending albums", () => {
    const albums = new Map([
      [
        "100:g1",
        {
          chat_id: 100,
          media_group_id: "g1",
          messages: [
            {
              message_id: 1,
              date: 0,
              chat: { id: 100, type: "private" },
              media_group_id: "g1",
              photo: [
                {
                  file_id: "p",
                  file_unique_id: "u",
                  width: 1,
                  height: 1,
                },
              ],
            },
          ],
        },
      ],
    ]);
    expect(
      selectAlbumsToClose({
        pendingBeforeKeys: new Set(["100:g1"]),
        albums,
        touchedKeys: new Set(),
        batchMessagesInOrder: [],
      }),
    ).toEqual(["100:g1"]);
  });

  it("load/save/update config persists awaiting_delete and snaps folder", async () => {
    const dataDir = await tempDataDir();
    const fs = new NodeFileSystemAdapter();
    await saveTelegramPluginConfig(
      fs,
      dataDir,
      "v1",
      baseConfig({
        folder_path: "Gone",
        awaiting_delete: [{ chat_id: 1, message_id: 2 }],
        imported: [{ chat_id: 1, message_id: 2 }],
        sync_interval_ms: 120_000,
      }),
    );
    const updated = await updateTelegramPluginConfig(
      fs,
      dataDir,
      "v1",
      {},
      ["Inbox", "Work"],
    );
    expect(updated.folder_path).toBe(INBOX_FOLDER_NAME);
    expect(updated.awaiting_delete).toEqual([{ chat_id: 1, message_id: 2 }]);
    expect(updated.imported).toEqual([{ chat_id: 1, message_id: 2 }]);
    expect(updated.sync_interval_ms).toBe(120_000);
    const loaded = await loadTelegramPluginConfig(fs, dataDir, "v1");
    expect(loaded.enabled).toBe(true);
    expect(loaded.bot_username).toBe("bot");
    expect(loaded.pending_albums).toEqual([]);
    expect(loaded.imported).toEqual([{ chat_id: 1, message_id: 2 }]);
    expect(loaded.sync_interval_ms).toBe(120_000);
  });

  it("missing imported / sync_interval_ms normalize to defaults", async () => {
    const dataDir = await tempDataDir();
    const fs = new NodeFileSystemAdapter();
    const path = join(dataDir, "sync-plugins", "telegram", "v1.json");
    await fs.mkdir(join(dataDir, "sync-plugins", "telegram"));
    await fs.writeText(
      path,
      `${JSON.stringify({
        schema_version: 1,
        enabled: true,
        folder_path: "Inbox",
        bot_username: null,
        last_sync_at: null,
        awaiting_delete: [],
      })}\n`,
    );
    const loaded = await loadTelegramPluginConfig(fs, dataDir, "v1");
    expect(loaded.imported).toEqual([]);
    expect(loaded.sync_interval_ms).toBe(300_000);
  });
});

describe("createTelegramSyncPlugin (#415 / #433)", () => {
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

  it("album becomes one item; ack deletes all message ids", async () => {
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

    const deleteMessage = vi.fn(async () => true as const);
    let pullCount = 0;
    const api = mockApi({
      getUpdates: vi.fn(async () => {
        pullCount += 1;
        if (pullCount === 1) {
          return [
            {
              update_id: 1,
              message: {
                message_id: 1,
                date: 1,
                chat: { id: 100, type: "private" },
                media_group_id: "album1",
                caption: "album",
                photo: [
                  {
                    file_id: "p1",
                    file_unique_id: "u1",
                    width: 10,
                    height: 10,
                    file_size: 4,
                  },
                ],
              },
            },
            {
              update_id: 2,
              message: {
                message_id: 2,
                date: 1,
                chat: { id: 100, type: "private" },
                media_group_id: "album1",
                photo: [
                  {
                    file_id: "p2",
                    file_unique_id: "u2",
                    width: 10,
                    height: 10,
                    file_size: 4,
                  },
                ],
              },
            },
          ];
        }
        return [];
      }),
      deleteMessage,
      getFile: vi.fn(async (_t: string, fileId: string) => ({
        file_id: fileId,
        file_unique_id: fileId,
        file_path: `photos/${fileId}.jpg`,
        file_size: 4,
      })),
      downloadFile: vi.fn(async () => new Uint8Array([9, 9, 9, 9])),
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

    const first = await plugin.pull(null);
    expect(first.items).toHaveLength(0);
    const pending = await loadTelegramPluginConfig(fs, dataDir, "v1");
    expect(pending.pending_albums).toHaveLength(1);

    const attachMediaFiles = vi.fn(async () => []);
    const createItem = vi.fn(async (input: { title: string }) => ({
      id: `Inbox/${input.title}.md`,
      title: input.title,
    }));
    const registry = createSyncPluginRegistry({
      fs,
      dataDir,
      resolveActiveVaultId: async () => "v1",
      createItem: createItem as never,
      attachMediaFiles,
      deleteItem: vi.fn(async () => {}),
createCatalog: () => [plugin],
    });

    const second = await registry.syncNow(TELEGRAM_PLUGIN_ID);
    expect(second.importedCount).toBe(1);
    expect(createItem).toHaveBeenCalledTimes(1);
    expect(attachMediaFiles).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({ name: expect.any(String) }),
        expect.objectContaining({ name: expect.any(String) }),
      ]),
    );
    expect(deleteMessage).toHaveBeenCalledWith("tok", 100, 1);
    expect(deleteMessage).toHaveBeenCalledWith("tok", 100, 2);
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
    await saveTelegramPluginConfig(fs, dataDir, "v1", baseConfig());

    const deleteMessage = vi.fn(async () => true as const);
    const api = mockApi({
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
      deleteItem: vi.fn(async () => {}),
createCatalog: () => [plugin],
    });

    const first = await registry.syncNow(TELEGRAM_PLUGIN_ID);
    expect(first.importedCount).toBe(1);
    expect(deleteMessage).toHaveBeenCalledWith("tok", 100, 5);
    expect(createItem).toHaveBeenCalledTimes(1);

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
    await saveTelegramPluginConfig(fs, dataDir, "v1", baseConfig());

    const api = mockApi({
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

    const registry = createSyncPluginRegistry({
      fs,
      dataDir,
      resolveActiveVaultId: async () => "v1",
      createItem: vi.fn(async (input: { title: string }) => ({
        id: `Inbox/${input.title}.md`,
        title: input.title,
      })) as never,
      attachMediaFiles: vi.fn(async () => []),
      deleteItem: vi.fn(async () => {}),
createCatalog: () => [plugin],
    });

    await expect(registry.syncNow(TELEGRAM_PLUGIN_ID)).rejects.toThrow(
      /delete failed/,
    );
    const cfg = await loadTelegramPluginConfig(fs, dataDir, "v1");
    expect(cfg.awaiting_delete).toEqual([{ chat_id: 3, message_id: 9 }]);
    expect(cfg.imported).toEqual([{ chat_id: 3, message_id: 9 }]);
  });

  it("imported blocks re-import until clearImported after cursor", async () => {
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

    const update = {
      update_id: 10,
      message: {
        message_id: 5,
        date: 1,
        chat: { id: 100, type: "private" as const },
        text: "hello",
      },
    };
    const getUpdates = vi.fn(async () => [update]);
    const deleteMessage = vi.fn(async () => true as const);
    const api = mockApi({ getUpdates, deleteMessage });

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
      deleteItem: vi.fn(async () => {}),
createCatalog: () => [plugin],
    });

    const first = await registry.syncNow(TELEGRAM_PLUGIN_ID);
    expect(first.importedCount).toBe(1);
    expect(createItem).toHaveBeenCalledTimes(1);
    let cfg = await loadTelegramPluginConfig(fs, dataDir, "v1");
    expect(cfg.imported).toEqual([]);
    expect(cfg.awaiting_delete).toEqual([]);

    await fs.writeText(
      join(dataDir, "sync-plugins", "v1.json"),
      `${JSON.stringify({ schema_version: 1, cursors: { telegram: null } }, null, 2)}\n`,
    );
    await saveTelegramPluginConfig(fs, dataDir, "v1", {
      ...(await loadTelegramPluginConfig(fs, dataDir, "v1")),
      imported: [{ chat_id: 100, message_id: 5 }],
    });

    const second = await registry.syncNow(TELEGRAM_PLUGIN_ID);
    expect(second.importedCount).toBe(0);
    expect(createItem).toHaveBeenCalledTimes(1);

    cfg = await loadTelegramPluginConfig(fs, dataDir, "v1");
    // No new imports → clearImported not called; mark stays until a successful import cycle.
    expect(cfg.imported).toEqual([{ chat_id: 100, message_id: 5 }]);
  });

  it("new message_id imports again after successful cycle", async () => {
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

    const getUpdates = vi
      .fn()
      .mockResolvedValueOnce([
        {
          update_id: 1,
          message: {
            message_id: 1,
            date: 1,
            chat: { id: 100, type: "private" },
            text: "one",
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          update_id: 2,
          message: {
            message_id: 2,
            date: 2,
            chat: { id: 100, type: "private" },
            text: "two",
          },
        },
      ]);
    const api = mockApi({
      getUpdates,
      deleteMessage: vi.fn(async () => true as const),
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
      deleteItem: vi.fn(async () => {}),
createCatalog: () => [plugin],
    });

    expect((await registry.syncNow(TELEGRAM_PLUGIN_ID)).importedCount).toBe(1);
    expect((await registry.syncNow(TELEGRAM_PLUGIN_ID)).importedCount).toBe(1);
    expect(createItem).toHaveBeenCalledTimes(2);
  });

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

    let inFlight = 0;
    let peakInFlight = 0;
    const deleteMessage = vi.fn(async () => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 40));
      inFlight -= 1;
      return true as const;
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

    expect(deleteMessage).toHaveBeenCalledTimes(3);
    expect(peakInFlight).toBeGreaterThan(1);
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

    let inFlight = 0;
    let peakInFlight = 0;
    const deleteMessage = vi.fn(
      async (_token: string, _chatId: number, messageId: number) => {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 40));
        inFlight -= 1;
        if (messageId % 2 === 0) {
          throw new Error(`delete failed for ${messageId}`);
        }
        return true as const;
      },
    );
    const plugin = await pluginForFlush(
      dataDir,
      fs,
      mockApi({
        getUpdates: vi.fn(async () => []),
        deleteMessage,
      }),
    );

    await plugin.pull(null);

    expect(peakInFlight).toBeGreaterThan(1);
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

    const configPath = join(dataDir, "sync-plugins/telegram", "v1.json");
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
