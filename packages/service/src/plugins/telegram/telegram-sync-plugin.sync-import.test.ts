/**
 * syncNow import paths (#415 / #433 / #922).
 *
 * Live vault createItem/attachMedia for happy-path import + album.
 * Mock vault only for registry error-ledger branches (ack failure / skip re-import).
 */
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  SqlVaultIndexStore,
  createVault,
  itemMarkdownPath,
  listItemMediaWithPaths,
  readItemFile,
  type VaultContext,
} from "@collector/core";
import { NodeFileSystemAdapter } from "@collector/core/node";
import type { VaultMeta } from "@collector/shared";
import { MemorySqlAdapter } from "../../../../core/src/testing/memory-sql.js";
import {
  createMemoryKeychainBackend,
  createCredentialsService,
} from "../../credentials.js";
import { createItemsCrud } from "../../items-crud.js";
import { createMediaCoverService } from "../../media-cover.js";
import { createSyncPluginRegistry } from "../../sync-plugin-registry.js";
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

/** Real vault createItem/attachMediaFiles — same wiring as production sync runtime. */
async function openLiveVaultWriters(dataDir: string): Promise<{
  fs: NodeFileSystemAdapter;
  vault: VaultMeta;
  vaultPath: string;
  ctx: VaultContext;
  createItem: ReturnType<typeof createItemsCrud>["createItem"];
  attachMediaFiles: ReturnType<
    typeof createMediaCoverService
  >["attachMediaFiles"];
  deleteItem: ReturnType<typeof createItemsCrud>["deleteItem"];
}> {
  const fs = new NodeFileSystemAdapter();
  const sql = new MemorySqlAdapter();
  const index = new SqlVaultIndexStore(sql);
  const ctx: VaultContext = { fs, index };
  const { meta: vault, path: vaultPath } = await createVault(ctx, dataDir, {
    name: "Vault",
  });

  const crud = createItemsCrud(
    {
      resolveActiveVault: async () => ({ path: vaultPath, vault }),
      getContext: () => ctx,
      getIndex: () => index,
      normalizeMarkdown: (raw: string) => ({ text: raw, changed: false }),
      enqueueItemDerivedRefresh: async () => undefined,
      enqueueItemExtractAuto: async () => undefined,
    } as never,
    () => crypto.randomUUID(),
  );

  const media = createMediaCoverService({
    resolveActiveVault: async () => ({ path: vaultPath, vault }),
    getContext: () => ctx,
    enqueueGenerateCover: async () => ({ id: "cover-job" }),
    waitForCoverJob: async () => "succeeded" as const,
    cancelPendingGenerateCoversForItem: async () => 0,
    resolveThumbnailPathsProgressive: async () => undefined,
    readCoverPixelSize: async () => ({ width: 1, height: 1 }),
  });

  return {
    fs,
    vault,
    vaultPath,
    ctx,
    createItem: (input) => crud.createItem(input),
    attachMediaFiles: (itemId, files) => media.attachMediaFiles(itemId, files),
    deleteItem: (itemId) => crud.deleteItem(itemId),
  };
}

describe("createTelegramSyncPlugin sync-import live vault (#922)", () => {
  it("pull → import writes a real vault note and acks delete", async () => {
    const dataDir = await tempDataDir();
    const writers = await openLiveVaultWriters(dataDir);
    const { fs, vault, vaultPath, ctx, createItem, attachMediaFiles, deleteItem } =
      writers;

    const credentials = createCredentialsService({
      backend: createMemoryKeychainBackend(),
    });
    await credentials.setCredential({
      pluginId: TELEGRAM_PLUGIN_ID,
      key: "bot_token",
      secret: "tok",
    });
    await saveTelegramPluginConfig(fs, dataDir, vault.id, baseConfig());

    const deleteMessage = vi.fn(async () => true as const);
    const api = mockApi({
      getUpdates: vi.fn(async () => [
        {
          update_id: 10,
          message: {
            message_id: 5,
            date: 1,
            chat: { id: 100, type: "private" },
            text: "hello live vault",
          },
        },
      ]),
      deleteMessage,
    });

    const plugin = createTelegramSyncPlugin({
      credentials,
      fs,
      dataDir,
      resolveActiveVaultId: async () => vault.id,
      listFolderTree: async () => [
        { name: "Inbox", path: "Inbox", item_count: 0, children: [] },
      ],
      api,
    });

    const registry = createSyncPluginRegistry({
      fs,
      dataDir,
      resolveActiveVaultId: async () => vault.id,
      createItem,
      attachMediaFiles,
      deleteItem,
      createCatalog: () => [plugin],
    });

    const result = await registry.syncNow(TELEGRAM_PLUGIN_ID);
    expect(result.importedCount).toBe(1);
    expect(result.itemIds).toHaveLength(1);
    const itemId = result.itemIds[0]!;
    expect(await fs.exists(itemMarkdownPath(vaultPath, itemId))).toBe(true);
    const onDisk = await readItemFile(fs, vaultPath, itemId, vault.id);
    expect(onDisk.title).toBe("hello live vault");
    expect(onDisk.folder_path).toBe("Inbox");
    expect(deleteMessage).toHaveBeenCalledWith("tok", 100, 5);
    expect(await listItemMediaWithPaths(ctx, vaultPath, itemId)).toHaveLength(0);
  });

  it("album becomes one vault item with two media files; ack deletes all ids", async () => {
    const dataDir = await tempDataDir();
    const writers = await openLiveVaultWriters(dataDir);
    const { fs, vault, vaultPath, ctx, createItem, attachMediaFiles, deleteItem } =
      writers;

    const credentials = createCredentialsService({
      backend: createMemoryKeychainBackend(),
    });
    await credentials.setCredential({
      pluginId: TELEGRAM_PLUGIN_ID,
      key: "bot_token",
      secret: "tok",
    });
    await saveTelegramPluginConfig(fs, dataDir, vault.id, baseConfig());

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
                caption: "album live",
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
      resolveActiveVaultId: async () => vault.id,
      listFolderTree: async () => [
        { name: "Inbox", path: "Inbox", item_count: 0, children: [] },
      ],
      api,
    });

    const first = await plugin.pull(null);
    expect(first.items).toHaveLength(0);
    const pending = await loadTelegramPluginConfig(fs, dataDir, vault.id);
    expect(pending.pending_albums).toHaveLength(1);

    const registry = createSyncPluginRegistry({
      fs,
      dataDir,
      resolveActiveVaultId: async () => vault.id,
      createItem,
      attachMediaFiles,
      deleteItem,
      createCatalog: () => [plugin],
    });

    const second = await registry.syncNow(TELEGRAM_PLUGIN_ID);
    expect(second.importedCount).toBe(1);
    expect(second.itemIds).toHaveLength(1);
    const itemId = second.itemIds[0]!;
    const onDisk = await readItemFile(fs, vaultPath, itemId, vault.id);
    expect(onDisk.title).toBe("album live");
    const media = await listItemMediaWithPaths(ctx, vaultPath, itemId);
    expect(media).toHaveLength(2);
    expect(deleteMessage).toHaveBeenCalledWith("tok", 100, 1);
    expect(deleteMessage).toHaveBeenCalledWith("tok", 100, 2);
  });
});

describe("createTelegramSyncPlugin sync-import ledger branches (mock vault) (#922)", () => {
  // Mock vault: these assert registry ledger / ack failure paths, not disk writes.

  it("awaiting_delete skips re-import", async () => {
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
});
