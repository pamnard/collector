import { describe, expect, it, vi } from "vitest";
import { isHostWireError } from "./errors.js";
import { DOMAIN_WIRE_METHODS as M } from "./domain-methods.js";
import type { ServiceDomainRuntime } from "../domain-runtime.js";
import {
  createDomainWireDispatcher,
  createDomainWireRequestHandler,
} from "./domain-dispatch.js";

function stubRuntime(overrides: {
  itemsSearch?: Partial<ServiceDomainRuntime["itemsSearch"]>;
  dropImport?: Partial<ServiceDomainRuntime["dropImport"]>;
  jobs?: Partial<ServiceDomainRuntime["jobs"]>;
}): {
  runtime: ServiceDomainRuntime;
  ensureInitialized: ReturnType<typeof vi.fn>;
} {
  const ensureInitialized = vi.fn(async () => undefined);
  const runtime = {
    ensureInitialized,
    dataDir: "/tmp/stub",
    open: vi.fn(async () => undefined),
    itemsSearch: {
      searchItems: vi.fn(async () => []),
      getItemById: vi.fn(async () => null),
      createItem: vi.fn(async (input: unknown) => input),
      updateItem: vi.fn(async (_id: string, input: unknown) => input),
      fetchDashboardIndexPage: vi.fn(),
      queryIndex: vi.fn(),
      listDashboardItemIds: vi.fn(),
      loadDashboardItems: vi.fn(),
      getAdjacentItems: vi.fn(),
      getItemSource: vi.fn(),
      deleteItem: vi.fn(),
      updateItemSource: vi.fn(),
      ...overrides.itemsSearch,
    },
    dropImport: {
      importDroppedFiles: vi.fn(async (input: unknown) => input),
      ...overrides.dropImport,
    },
    tagsFolders: {
      listTags: vi.fn(async () => []),
      createTag: vi.fn(),
      updateTagRecord: vi.fn(),
      deleteTag: vi.fn(),
      listFolderTree: vi.fn(async () => []),
      createFolder: vi.fn(),
      renameFolder: vi.fn(),
      deleteFolder: vi.fn(),
      moveItemToFolderPath: vi.fn(),
    },
    mediaCover: {
      listItemMedia: vi.fn(async () => []),
      setItemCoverFromMedia: vi.fn(),
      attachMediaFiles: vi.fn(),
      replaceItemMedia: vi.fn(),
      deleteItemMedia: vi.fn(),
    },
    vaults: {
      listVaults: vi.fn(async () => []),
      getActiveVaultMeta: vi.fn(),
      switchVault: vi.fn(),
      setDefaultVault: vi.fn(),
      ensureActiveVault: vi.fn(),
    },
    appSettings: {
      ensureAppSettings: vi.fn(),
      updateAppSettings: vi.fn(),
      getAppConfigDirectory: vi.fn(async () => "/tmp"),
    },
    credentials: {
      setCredential: vi.fn(async () => undefined),
      getCredential: vi.fn(async () => null),
      hasCredential: vi.fn(async () => false),
      deleteCredential: vi.fn(async () => undefined),
      getCredentialsAvailability: vi.fn(async () => ({ available: true })),
    },
    syncPlugins: {
      syncNow: vi.fn(async () => ({ importedCount: 0, itemIds: [] })),
    },
    telegramSync: {
      getTelegramSyncSettings: vi.fn(async () => ({
        enabled: false,
        folder_path: "Inbox",
        bot_username: null,
        last_sync_at: null,
        sync_interval_ms: 300_000,
      })),
      updateTelegramSyncSettings: vi.fn(async (patch: unknown) => patch),
      validateTelegramBotToken: vi.fn(async () => ({
        id: 1,
        username: "bot",
        first_name: "Bot",
      })),
    },
    syncPluginWake: {
      register: vi.fn(),
      notifyVaultReady: vi.fn(async () => undefined),
      dispose: vi.fn(),
    },
    vaultIndexSyncStatus: { get: vi.fn(async () => ({})) },
    startVaultFilesystemWatcher: vi.fn(),
    stopVaultFilesystemWatcher: vi.fn(),
    isVaultFilesystemWatcherActive: vi.fn(() => false),
    jobs: {
      enqueue: vi.fn(),
      cancel: vi.fn(),
      stats: vi.fn(async () => ({
        pending: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
        byType: {},
      })),
      start: vi.fn(),
      stop: vi.fn(async () => undefined),
      ...overrides.jobs,
    },
  } as unknown as ServiceDomainRuntime;
  return { runtime, ensureInitialized };
}

async function expectBadRequest(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
    expect.unreachable("expected bad_request");
  } catch (error) {
    expect(isHostWireError(error)).toBe(true);
    if (isHostWireError(error)) {
      expect(error.code).toBe("bad_request");
    }
  }
}

describe("createDomainWireDispatcher", () => {
  it("returns undefined for unknown methods", async () => {
    const dispatch = createDomainWireDispatcher({});
    expect(await dispatch("noSuchMethod", { a: 1 })).toBeUndefined();
  });

  it("forwards params to the registered handler", async () => {
    const handler = vi.fn(async (params?: unknown) => ({ ok: true, params }));
    const dispatch = createDomainWireDispatcher({
      ping: handler,
    });
    await expect(dispatch("ping", { n: 2 })).resolves.toEqual({
      ok: true,
      params: { n: 2 },
    });
    expect(handler).toHaveBeenCalledWith({ n: 2 });
  });
});

describe("createDomainWireRequestHandler (#330)", () => {
  it("returns undefined for unknown methods", async () => {
    const { runtime } = stubRuntime({});
    const dispatch = createDomainWireRequestHandler(runtime);
    expect(await dispatch("noSuchMethod", { a: 1 })).toBeUndefined();
  });

  it("rejects bad searchItems params before ensureInitialized", async () => {
    const { runtime, ensureInitialized } = stubRuntime({});
    const dispatch = createDomainWireRequestHandler(runtime);
    await expectBadRequest(() => dispatch(M.searchItems, {}));
    expect(ensureInitialized).not.toHaveBeenCalled();
  });

  it("searchItems and getItemById forward after ensureInitialized", async () => {
    const searchItems = vi.fn(async () => [{ id: "a.md" }]);
    const getItemById = vi.fn(async () => ({ id: "a.md" }));
    const { runtime, ensureInitialized } = stubRuntime({
      itemsSearch: { searchItems, getItemById },
    });
    const dispatch = createDomainWireRequestHandler(runtime);

    await expect(
      dispatch(M.searchItems, { query: "hello", filter: "all" }),
    ).resolves.toEqual([{ id: "a.md" }]);
    expect(searchItems).toHaveBeenCalledWith("hello", "all");

    await expect(dispatch(M.getItemById, { itemId: "a.md" })).resolves.toEqual({
      id: "a.md",
    });
    expect(getItemById).toHaveBeenCalledWith("a.md");
    expect(ensureInitialized).toHaveBeenCalledTimes(2);
  });

  it("rejects bad createItem / updateItem before ensureInitialized", async () => {
    const { runtime, ensureInitialized } = stubRuntime({});
    const dispatch = createDomainWireRequestHandler(runtime);

    await expectBadRequest(() => dispatch(M.createItem, { title: "x" }));
    await expectBadRequest(() => dispatch(M.updateItem, { itemId: "a.md" }));
    expect(ensureInitialized).not.toHaveBeenCalled();
  });

  it("createItem and updateItem forward after ensureInitialized", async () => {
    const createItem = vi.fn(async (input: unknown) => ({ id: "n.md", input }));
    const updateItem = vi.fn(async (id: string, input: unknown) => ({
      id,
      input,
    }));
    const { runtime, ensureInitialized } = stubRuntime({
      itemsSearch: { createItem, updateItem },
    });
    const dispatch = createDomainWireRequestHandler(runtime);

    await expect(
      dispatch(M.createItem, {
        title: "Note",
        content_type: "note",
        content: "hi",
      }),
    ).resolves.toMatchObject({ id: "n.md" });
    expect(createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Note",
        content_type: "note",
        content: "hi",
      }),
    );

    await expect(
      dispatch(M.updateItem, {
        itemId: "n.md",
        input: { title: "Renamed" },
      }),
    ).resolves.toEqual({ id: "n.md", input: { title: "Renamed" } });
    expect(updateItem).toHaveBeenCalledWith("n.md", { title: "Renamed" });
    expect(ensureInitialized).toHaveBeenCalledTimes(2);
  });

  it("importDroppedFiles decodes base64 bytes and forwards", async () => {
    const importDroppedFiles = vi.fn(async (input: unknown) => input);
    const { runtime, ensureInitialized } = stubRuntime({
      dropImport: { importDroppedFiles },
    });
    const dispatch = createDomainWireRequestHandler(runtime);
    const dataBase64 = Buffer.from("hello").toString("base64");

    await expect(
      dispatch(M.importDroppedFiles, {
        folder_path: "Inbox",
        files: [
          {
            relativePath: "shot.png",
            name: "shot.png",
            dataBase64,
          },
        ],
      }),
    ).resolves.toMatchObject({ folder_path: "Inbox" });

    expect(importDroppedFiles).toHaveBeenCalledWith({
      folder_path: "Inbox",
      files: [
        {
          relativePath: "shot.png",
          name: "shot.png",
          bytes: Uint8Array.from(Buffer.from("hello")),
        },
      ],
    });
    expect(ensureInitialized).toHaveBeenCalledTimes(1);
  });

  it("syncNow (#29)", async () => {
    const syncNow = vi.fn(async () => ({
      importedCount: 1,
      itemIds: ["Inbox/x.md"],
    }));
    const { runtime, ensureInitialized } = stubRuntime({});
    (runtime as { syncPlugins: unknown }).syncPlugins = { syncNow };
    const dispatch = createDomainWireRequestHandler(runtime);

    await expect(dispatch(M.syncNow, { pluginId: "mock" })).resolves.toEqual({
      importedCount: 1,
      itemIds: ["Inbox/x.md"],
    });
    expect(syncNow).toHaveBeenCalledWith("mock");
    expect(ensureInitialized).toHaveBeenCalledTimes(1);

    await expectBadRequest(() => dispatch(M.syncNow, {}));
  });

  it("ensureActiveVault does not notify sync plugin wake (#436)", async () => {
    const ensureActiveVault = vi.fn(async () => ({
      vault: { id: "v1" },
      path: "/tmp/v",
    }));
    const notifyVaultReady = vi.fn(async () => undefined);
    const { runtime, ensureInitialized } = stubRuntime({});
    (runtime as { vaults: { ensureActiveVault: unknown } }).vaults = {
      ...runtime.vaults,
      ensureActiveVault,
    };
    (runtime as { syncPluginWake: { notifyVaultReady: unknown } }).syncPluginWake =
      {
        register: vi.fn(),
        notifyVaultReady,
        dispose: vi.fn(),
      };
    const dispatch = createDomainWireRequestHandler(runtime);
    await expect(dispatch(M.ensureActiveVault)).resolves.toMatchObject({
      vault: { id: "v1" },
    });
    expect(ensureInitialized).toHaveBeenCalled();
    expect(notifyVaultReady).not.toHaveBeenCalled();
  });

  it("switchVault still notifies sync plugin wake", async () => {
    const switchVault = vi.fn(async () => ({
      vault: { id: "v2" },
      path: "/tmp/v2",
    }));
    const notifyVaultReady = vi.fn(async () => undefined);
    const { runtime, ensureInitialized } = stubRuntime({});
    (runtime as { vaults: { switchVault: unknown } }).vaults = {
      ...runtime.vaults,
      switchVault,
    };
    (runtime as { syncPluginWake: { notifyVaultReady: unknown } }).syncPluginWake =
      {
        register: vi.fn(),
        notifyVaultReady,
        dispose: vi.fn(),
      };
    const dispatch = createDomainWireRequestHandler(runtime);
    await expect(
      dispatch(M.switchVault, { vaultId: "v2" }),
    ).resolves.toMatchObject({ vault: { id: "v2" } });
    expect(ensureInitialized).toHaveBeenCalled();
    expect(notifyVaultReady).toHaveBeenCalledTimes(1);
  });

  it("getJobStats returns queue stats (#630)", async () => {
    const { runtime, ensureInitialized } = stubRuntime({
      jobs: {
        stats: vi.fn(async () => ({
          pending: 1,
          running: 0,
          succeeded: 2,
          failed: 0,
          cancelled: 0,
          byType: {
            __test_noop: {
              pending: 1,
              running: 0,
              succeeded: 2,
              failed: 0,
              cancelled: 0,
            },
          },
        })),
      },
    });
    const dispatch = createDomainWireRequestHandler(runtime);
    await expect(dispatch(M.getJobStats)).resolves.toMatchObject({
      pending: 1,
      succeeded: 2,
      byType: { __test_noop: { pending: 1, succeeded: 2 } },
    });
    expect(ensureInitialized).toHaveBeenCalled();
  });
});

