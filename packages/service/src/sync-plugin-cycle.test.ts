import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttachMediaFileInput, SyncPlugin } from "@collector/api";
import type { VaultMeta } from "@collector/shared";
import {
  SqlVaultIndexStore,
  createVault,
  itemMarkdownPath,
  listItemMediaWithPaths,
  readItemFile,
  readItemRawMarkdown,
  type VaultContext,
} from "@collector/core";
import { NodeFileSystemAdapter } from "@collector/core/node";
import { MemorySqlAdapter } from "../../core/src/testing/memory-sql.js";
import {
  createCredentialsService,
  createMemoryKeychainBackend,
} from "./credentials.js";
import { createItemsCrud } from "./items-crud.js";
import { createMediaCoverService } from "./media-cover.js";
import { runSyncPluginCycle } from "./sync-plugin-cycle.js";
import { createSyncPluginHandoff } from "./sync-plugin-handoff.js";
import type { TelegramBotApi } from "./plugins/telegram/telegram-bot-api.js";
import {
  loadTelegramPluginConfig,
  saveTelegramPluginConfig,
  TELEGRAM_BOT_TOKEN_KEY,
  TELEGRAM_PLUGIN_ID,
  type TelegramPluginConfig,
} from "./plugins/telegram/telegram-config.js";
import { createTelegramSyncPlugin } from "./plugins/telegram/telegram-sync-plugin.js";

describe("runSyncPluginCycle vault + telegram handoff", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

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

  async function openCycle(options?: {
    api?: TelegramBotApi;
    failAttachWith?: Error;
  }): Promise<{
    plugin: SyncPlugin;
    handoff: ReturnType<typeof createSyncPluginHandoff>;
    ctx: VaultContext;
    vault: VaultMeta;
    vaultPath: string;
    vaultId: string;
  }> {
    dataDir = await mkdtemp(join(tmpdir(), "collector-sync-cycle-"));
    const sql = new MemorySqlAdapter();
    const index = new SqlVaultIndexStore(sql);
    const ctx: VaultContext = { fs, index };
    const { meta: vault, path: vaultPath } = await createVault(ctx, dataDir, {
      name: "Vault",
    });
    const vaultId = vault.id;

    const credentials = createCredentialsService({
      backend: createMemoryKeychainBackend(),
    });
    await credentials.setCredential({
      pluginId: TELEGRAM_PLUGIN_ID,
      key: TELEGRAM_BOT_TOKEN_KEY,
      secret: "tok",
    });
    await saveTelegramPluginConfig(fs, dataDir, vaultId, baseConfig());

    const api = options?.api ?? mockApi();

    const plugin = createTelegramSyncPlugin({
      credentials,
      fs,
      dataDir,
      resolveActiveVaultId: async () => vaultId,
      listFolderTree: async () => [
        { name: "Inbox", path: "Inbox", item_count: 0, children: [] },
      ],
      api,
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

    const attachMediaFiles = options?.failAttachWith
      ? async (_itemId: string, _files: AttachMediaFileInput[]) => {
          throw options.failAttachWith;
        }
      : (itemId: string, files: AttachMediaFileInput[]) =>
          media.attachMediaFiles(itemId, files);

    return {
      plugin,
      handoff: createSyncPluginHandoff({
        createItem: (input) => crud.createItem(input),
        attachMediaFiles,
        deleteItem: (itemId) => crud.deleteItem(itemId),
      }),
      ctx,
      vault,
      vaultPath,
      vaultId,
    };
  }

  it("authenticate → pull → vault create → ack; status and files match", async () => {
    const deleteMessage = vi.fn(async () => true as const);
    const api = mockApi({
      getUpdates: vi.fn(async () => [
        {
          update_id: 1,
          message: {
            message_id: 10,
            date: 1,
            chat: { id: 100, type: "private" },
            text: "Alpha note",
          },
        },
        {
          update_id: 2,
          message: {
            message_id: 11,
            date: 2,
            chat: { id: 100, type: "private" },
            text: "Beta note",
          },
        },
      ]),
      deleteMessage,
    });
    const { plugin, handoff, vault, vaultPath, vaultId } = await openCycle({
      api,
    });

    const result = await runSyncPluginCycle({
      plugin,
      cursor: null,
      handoff,
    });

    expect(result.importedRemoteIds).toEqual(["100:10", "100:11"]);
    expect(result.itemIds).toHaveLength(2);
    expect(result.nextCursor).toBeTruthy();

    for (const itemId of result.itemIds) {
      expect(await fs.exists(itemMarkdownPath(vaultPath, itemId))).toBe(true);
    }
    const first = await readItemFile(fs, vaultPath, result.itemIds[0]!, vault.id);
    const second = await readItemFile(
      fs,
      vaultPath,
      result.itemIds[1]!,
      vault.id,
    );
    expect(first.title).toBe("Alpha note");
    expect(second.title).toBe("Beta note");
    expect(await readItemRawMarkdown(fs, vaultPath, result.itemIds[0]!)).toContain(
      "Alpha note",
    );
    expect(first.source_type).toBe("plugin");

    expect(deleteMessage).toHaveBeenCalledWith("tok", 100, 10);
    expect(deleteMessage).toHaveBeenCalledWith("tok", 100, 11);

    const cfg = await loadTelegramPluginConfig(fs, dataDir, vaultId);
    expect(cfg.awaiting_delete).toEqual([]);
    expect(cfg.imported).toEqual([
      { chat_id: 100, message_id: 10 },
      { chat_id: 100, message_id: 11 },
    ]);

    const empty = await runSyncPluginCycle({
      plugin,
      cursor: result.nextCursor,
      handoff,
    });
    expect(empty.importedRemoteIds).toEqual([]);
    expect(empty.itemIds).toEqual([]);
    expect(empty.nextCursor).toBe(result.nextCursor);
  });

  it("attaches media bytes to vault when pull returns a photo", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const api = mockApi({
      getUpdates: vi.fn(async () => [
        {
          update_id: 5,
          message: {
            message_id: 7,
            date: 1,
            chat: { id: 50, type: "private" },
            caption: "Shot",
            photo: [
              {
                file_id: "p1",
                file_unique_id: "u1",
                width: 10,
                height: 10,
                file_size: bytes.length,
              },
            ],
          },
        },
      ]),
      getFile: vi.fn(async () => ({
        file_id: "p1",
        file_unique_id: "u1",
        file_path: "photos/p1.jpg",
        file_size: bytes.length,
      })),
      downloadFile: vi.fn(async () => bytes),
      deleteMessage: vi.fn(async () => true as const),
    });
    const { plugin, handoff, ctx, vaultPath } = await openCycle({ api });

    const result = await runSyncPluginCycle({
      plugin,
      cursor: null,
      handoff,
    });

    expect(result.itemIds).toHaveLength(1);
    const mediaRows = await listItemMediaWithPaths(
      ctx,
      vaultPath,
      result.itemIds[0]!,
    );
    expect(mediaRows).toHaveLength(1);
    expect(await fs.exists(mediaRows[0]!.absolute_path)).toBe(true);
    expect(await fs.readBinary(mediaRows[0]!.absolute_path)).toEqual(bytes);
  });

  it("on attach failure deletes vault item and clears imported ledger", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const api = mockApi({
      getUpdates: vi.fn(async () => [
        {
          update_id: 1,
          message: {
            message_id: 9,
            date: 1,
            chat: { id: 3, type: "private" },
            photo: [
              {
                file_id: "bad",
                file_unique_id: "ub",
                width: 1,
                height: 1,
                file_size: 4,
              },
            ],
          },
        },
      ]),
      getFile: vi.fn(async () => ({
        file_id: "bad",
        file_unique_id: "ub",
        file_path: "photos/bad.jpg",
        file_size: 4,
      })),
      downloadFile: vi.fn(async () => bytes),
      deleteMessage: vi.fn(async () => true as const),
    });
    const { plugin, handoff, vaultPath, vaultId } = await openCycle({
      api,
      failAttachWith: new Error("FOREIGN KEY constraint failed"),
    });

    await expect(
      runSyncPluginCycle({ plugin, cursor: null, handoff }),
    ).rejects.toThrow(/FOREIGN KEY/);

    const cfg = await loadTelegramPluginConfig(fs, dataDir, vaultId);
    expect(cfg.imported).toEqual([]);
    expect(cfg.awaiting_delete).toEqual([{ chat_id: 3, message_id: 9 }]);

    const inbox = join(vaultPath, "Inbox");
    const leftovers = (await fs.exists(inbox))
      ? (await fs.readDir(inbox)).filter((name) => name.endsWith(".md"))
      : [];
    expect(leftovers).toEqual([]);
  });

  it("on mid-batch attach failure keeps prior vault item and acks it", async () => {
    const bytes = new Uint8Array([9, 9, 9, 9]);
    const deleteMessage = vi.fn(async () => true as const);
    const api = mockApi({
      getUpdates: vi.fn(async () => [
        {
          update_id: 1,
          message: {
            message_id: 1,
            date: 1,
            chat: { id: 100, type: "private" },
            text: "Ok first",
          },
        },
        {
          update_id: 2,
          message: {
            message_id: 2,
            date: 2,
            chat: { id: 100, type: "private" },
            caption: "Bad second",
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
      ]),
      getFile: vi.fn(async () => ({
        file_id: "p2",
        file_unique_id: "u2",
        file_path: "photos/p2.jpg",
        file_size: 4,
      })),
      downloadFile: vi.fn(async () => bytes),
      deleteMessage,
    });
    // Text items skip attachMediaFiles; only the photo item hits this fault.
    const { plugin, handoff, vault, vaultPath, vaultId } = await openCycle({
      api,
      failAttachWith: new Error("attach failed"),
    });

    await expect(
      runSyncPluginCycle({ plugin, cursor: null, handoff }),
    ).rejects.toThrow(/attach failed/);

    expect(deleteMessage).toHaveBeenCalledWith("tok", 100, 1);
    expect(deleteMessage).not.toHaveBeenCalledWith("tok", 100, 2);

    const cfg = await loadTelegramPluginConfig(fs, dataDir, vaultId);
    expect(cfg.imported).toEqual([{ chat_id: 100, message_id: 1 }]);
    expect(cfg.awaiting_delete).toEqual([{ chat_id: 100, message_id: 2 }]);

    const inbox = join(vaultPath, "Inbox");
    const notes = (await fs.readDir(inbox)).filter((name) =>
      name.endsWith(".md"),
    );
    expect(notes).toHaveLength(1);
    const survivingId = `Inbox/${notes[0]}`;
    const onDisk = await readItemFile(fs, vaultPath, survivingId, vault.id);
    expect(onDisk.title).toBe("Ok first");
  });

  it("retry after attach fail + ledger clear writes one vault note", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    let attachFails = true;
    const api = mockApi({
      getUpdates: vi.fn(async () => [
        {
          update_id: 1,
          message: {
            message_id: 5,
            date: 1,
            chat: { id: 100, type: "private" },
            caption: "Once",
            photo: [
              {
                file_id: "p1",
                file_unique_id: "u1",
                width: 1,
                height: 1,
                file_size: 4,
              },
            ],
          },
        },
      ]),
      getFile: vi.fn(async () => ({
        file_id: "p1",
        file_unique_id: "u1",
        file_path: "photos/p1.jpg",
        file_size: 4,
      })),
      downloadFile: vi.fn(async () => bytes),
      deleteMessage: vi.fn(async () => true as const),
    });

    dataDir = await mkdtemp(join(tmpdir(), "collector-sync-cycle-"));
    const sql = new MemorySqlAdapter();
    const index = new SqlVaultIndexStore(sql);
    const ctx: VaultContext = { fs, index };
    const { meta: vault, path: vaultPath } = await createVault(ctx, dataDir, {
      name: "Vault",
    });
    const vaultId = vault.id;
    const credentials = createCredentialsService({
      backend: createMemoryKeychainBackend(),
    });
    await credentials.setCredential({
      pluginId: TELEGRAM_PLUGIN_ID,
      key: TELEGRAM_BOT_TOKEN_KEY,
      secret: "tok",
    });
    await saveTelegramPluginConfig(fs, dataDir, vaultId, baseConfig());

    const plugin = createTelegramSyncPlugin({
      credentials,
      fs,
      dataDir,
      resolveActiveVaultId: async () => vaultId,
      listFolderTree: async () => [
        { name: "Inbox", path: "Inbox", item_count: 0, children: [] },
      ],
      api,
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
    const handoff = createSyncPluginHandoff({
      createItem: (input) => crud.createItem(input),
      attachMediaFiles: async (itemId, files) => {
        if (attachFails) {
          throw new Error("FOREIGN KEY constraint failed");
        }
        return media.attachMediaFiles(itemId, files);
      },
      deleteItem: (itemId) => crud.deleteItem(itemId),
    });

    await expect(
      runSyncPluginCycle({ plugin, cursor: null, handoff }),
    ).rejects.toThrow(/FOREIGN KEY/);

    let cfg = await loadTelegramPluginConfig(fs, dataDir, vaultId);
    expect(cfg.imported).toEqual([]);
    expect(cfg.awaiting_delete).toEqual([{ chat_id: 100, message_id: 5 }]);

    await saveTelegramPluginConfig(fs, dataDir, vaultId, {
      ...cfg,
      awaiting_delete: [],
    });
    attachFails = false;

    const ok = await runSyncPluginCycle({ plugin, cursor: null, handoff });
    expect(ok.itemIds).toHaveLength(1);
    expect(await fs.exists(itemMarkdownPath(vaultPath, ok.itemIds[0]!))).toBe(
      true,
    );
    const mediaRows = await listItemMediaWithPaths(
      ctx,
      vaultPath,
      ok.itemIds[0]!,
    );
    expect(mediaRows).toHaveLength(1);

    cfg = await loadTelegramPluginConfig(fs, dataDir, vaultId);
    expect(cfg.awaiting_delete).toEqual([]);
    expect(cfg.imported).toEqual([{ chat_id: 100, message_id: 5 }]);
  });
});
