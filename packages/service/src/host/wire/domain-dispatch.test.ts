import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GetItemResult, SearchItemsResult } from "@collector/api";
import type { ItemFile } from "@collector/shared";
import { selfContainedCollectorProfileLayout } from "@collector/shared";
import { isHostWireError } from "./errors.js";
import { DOMAIN_WIRE_METHODS as M } from "./domain-methods.js";
import {
  createServiceDomainRuntime,
  type ServiceDomainRuntime,
} from "../domain-runtime.js";
import {
  createDomainWireDispatcher,
  createDomainWireRequestHandler,
} from "./domain-dispatch.js";

function stubRuntime(overrides: {
  itemsSearch?: Partial<ServiceDomainRuntime["itemsSearch"]>;
  dropImport?: Partial<ServiceDomainRuntime["dropImport"]>;
  waitDerived?: Partial<ServiceDomainRuntime["waitDerived"]>;
  jobs?: Partial<ServiceDomainRuntime["jobs"]>;
  derivedCatchUpStatus?: Partial<ServiceDomainRuntime["derivedCatchUpStatus"]>;
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
    waitDerived: {
      waitDerived: vi.fn(async () => ({
        status: "succeeded" as const,
        jobId: "job-1",
        contentRevision: 1,
      })),
      ...overrides.waitDerived,
    },
    tagsFolders: {
      listTags: vi.fn(async () => []),
      listFolderTree: vi.fn(async () => []),
      listFolderItems: vi.fn(async () => []),
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
    extract: {
      discoverExtractCandidates: vi.fn(async () => []),
      extractItemCandidate: vi.fn(async () => undefined),
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
    derivedCatchUpStatus: {
      get: vi.fn(() => ({
        vaultId: null,
        status: "idle" as const,
        pending: 0,
        running: 0,
      })),
      ...overrides.derivedCatchUpStatus,
    },
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
  const liveRuntimeDirs: string[] = [];
  const liveRuntimes: ServiceDomainRuntime[] = [];

  afterEach(async () => {
    for (const runtime of liveRuntimes.splice(0)) {
      await runtime.close();
    }
    for (const dir of liveRuntimeDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns undefined for unknown methods", async () => {
    const { runtime } = stubRuntime({});
    const dispatch = createDomainWireRequestHandler(runtime);
    expect(await dispatch("noSuchMethod", { a: 1 })).toBeUndefined();
  });

  it("rejects reverse-direction tag catalog RPCs (#842)", async () => {
    const { runtime } = stubRuntime({});
    const dispatch = createDomainWireRequestHandler(runtime);
    expect(await dispatch("createTag", { name: "x" })).toBeUndefined();
    expect(await dispatch("deleteTag", { tagId: "t1" })).toBeUndefined();
    expect(
      await dispatch("updateTagRecord", { tagId: "t1", input: { name: "y" } }),
    ).toBeUndefined();
    expect(M).not.toHaveProperty("createTag");
    expect(M).not.toHaveProperty("deleteTag");
    expect(M).not.toHaveProperty("updateTagRecord");
  });

  it("rejects bad searchItems params before ensureInitialized", async () => {
    const { runtime, ensureInitialized } = stubRuntime({});
    const dispatch = createDomainWireRequestHandler(runtime);
    await expectBadRequest(() => dispatch(M.searchItems, {}));
    expect(ensureInitialized).not.toHaveBeenCalled();
  });

  it("searchItems and getItemById return live domain results via dispatch", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-domain-dispatch-"));
    liveRuntimeDirs.push(dataDir);
    const runtime = createServiceDomainRuntime(
      selfContainedCollectorProfileLayout(dataDir),
    );
    liveRuntimes.push(runtime);
    await runtime.open();
    await runtime.ensureInitialized();
    await runtime.vaults.ensureActiveVault();
    const dispatch = createDomainWireRequestHandler(runtime);

    const marker = `UniqueWireProbe${Date.now()}`;
    const created = (await dispatch(M.createItem, {
      title: marker,
      content_type: "note",
      content: `body ${marker}`,
    })) as ItemFile;
    expect(created.id).toMatch(/\.md$/);
    expect(created.title).toBe(marker);

    const got = (await dispatch(M.getItemById, {
      itemId: created.id,
    })) as GetItemResult;
    expect(got.item.id).toBe(created.id);
    expect(got.item.title).toBe(marker);
    expect(got.content).toContain(marker);

    await expect(
      dispatch(M.getItemById, { itemId: "Inbox/missing-wire-dispatch.md" }),
    ).rejects.toThrow(/Item not found/);

    // createItem defers index refresh; search kicks vault sync — wait for FTS.
    let search: SearchItemsResult | undefined;
    await vi.waitFor(
      async () => {
        search = (await dispatch(M.searchItems, {
          query: marker,
          filter: "all",
        })) as SearchItemsResult;
        expect(search.items.some((item) => item.id === created.id)).toBe(true);
      },
      { timeout: 15_000, interval: 100 },
    );
    expect(search!.total).toBeGreaterThanOrEqual(1);
    expect(search!.offset).toBe(0);
    expect(
      search!.items.find((item) => item.id === created.id)?.title,
    ).toBe(marker);
  });

  it("listFolderItems forwards folderPath after ensureInitialized (#844)", async () => {
    const listFolderItems = vi.fn(async () => [
      { id: "Parent/a.md", folder_path: "Parent" },
    ]);
    const { runtime, ensureInitialized } = stubRuntime({});
    runtime.tagsFolders.listFolderItems = listFolderItems;
    const dispatch = createDomainWireRequestHandler(runtime);

    await expect(
      dispatch(M.listFolderItems, { folderPath: "Parent" }),
    ).resolves.toEqual([{ id: "Parent/a.md", folder_path: "Parent" }]);
    expect(listFolderItems).toHaveBeenCalledWith("Parent", undefined);
    expect(ensureInitialized).toHaveBeenCalledTimes(1);

    await expectBadRequest(() => dispatch(M.listFolderItems, {}));
  });

  it("listFolderItems forwards sort and rejects invalid keys (#869)", async () => {
    const listFolderItems = vi.fn(async () => []);
    const { runtime } = stubRuntime({});
    runtime.tagsFolders.listFolderItems = listFolderItems;
    const dispatch = createDomainWireRequestHandler(runtime);

    await dispatch(M.listFolderItems, {
      folderPath: "Parent",
      sort: { key: "word_count", dir: "desc" },
    });
    expect(listFolderItems).toHaveBeenCalledWith("Parent", {
      key: "word_count",
      dir: "desc",
    });

    await expectBadRequest(() =>
      dispatch(M.listFolderItems, {
        folderPath: "Parent",
        sort: { key: "tags", dir: "asc" },
      }),
    );
  });

  it("searchItems forwards optional page (#658)", async () => {
    const searchItems = vi.fn(async () => ({
      items: [{ id: "a.md" }],
      total: 1,
      offset: 20,
    }));
    const { runtime } = stubRuntime({
      itemsSearch: { searchItems },
    });
    const dispatch = createDomainWireRequestHandler(runtime);

    await dispatch(M.searchItems, {
      query: "hello",
      filter: "all",
      page: { limit: 10, offset: 20 },
    });
    expect(searchItems).toHaveBeenCalledWith("hello", "all", {
      limit: 10,
      offset: 20,
    });
  });

  it("rejects invalid searchItems page before ensureInitialized (#658)", async () => {
    const searchItems = vi.fn(async () => ({ items: [], total: 0, offset: 0 }));
    const { runtime, ensureInitialized } = stubRuntime({
      itemsSearch: { searchItems },
    });
    const dispatch = createDomainWireRequestHandler(runtime);

    await expectBadRequest(() =>
      dispatch(M.searchItems, {
        query: "hello",
        filter: "all",
        page: { limit: Number.NaN, offset: 0 },
      }),
    );
    await expectBadRequest(() =>
      dispatch(M.searchItems, {
        query: "hello",
        filter: "all",
        page: { limit: 0, offset: 0 },
      }),
    );
    await expectBadRequest(() =>
      dispatch(M.searchItems, {
        query: "hello",
        filter: "all",
        page: { limit: 10_000, offset: 0 },
      }),
    );
    await expectBadRequest(() =>
      dispatch(M.searchItems, {
        query: "hello",
        filter: "all",
        page: { limit: 10, offset: -1 },
      }),
    );
    expect(ensureInitialized).not.toHaveBeenCalled();
    expect(searchItems).not.toHaveBeenCalled();
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

  it("waitDerived forwards itemId + contentRevision (opt-in; not on updateItem) (#770)", async () => {
    const waitDerived = vi.fn(async () => ({
      status: "succeeded" as const,
      jobId: "job-derived-1",
      contentRevision: 7,
    }));
    const updateItem = vi.fn(async () => ({ id: "n.md", content_revision: 7 }));
    const { runtime, ensureInitialized } = stubRuntime({
      waitDerived: { waitDerived },
      itemsSearch: { updateItem },
    });
    const dispatch = createDomainWireRequestHandler(runtime);

    await expect(
      dispatch(M.updateItem, {
        itemId: "n.md",
        input: { title: "T" },
      }),
    ).resolves.toEqual({ id: "n.md", content_revision: 7 });
    expect(waitDerived).not.toHaveBeenCalled();

    await expect(
      dispatch(M.waitDerived, {
        itemId: "n.md",
        contentRevision: 7,
        timeoutMs: 1_000,
      }),
    ).resolves.toEqual({
      status: "succeeded",
      jobId: "job-derived-1",
      contentRevision: 7,
    });
    expect(waitDerived).toHaveBeenCalledWith("n.md", 7, { timeoutMs: 1_000 });
    expect(ensureInitialized).toHaveBeenCalledTimes(2);

    await expectBadRequest(() =>
      dispatch(M.waitDerived, { itemId: "n.md", contentRevision: 1.5 }),
    );
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

  it("discoverExtractCandidates and extractItemCandidate (#849)", async () => {
    const candidate = {
      extractorId: "mock",
      url: "https://example.com/mock-extract",
      meta: { source: "body" },
    };
    const discoverExtractCandidates = vi.fn(async () => [candidate]);
    const extractItemCandidate = vi.fn(async () => undefined);
    const { runtime, ensureInitialized } = stubRuntime({});
    (runtime as { extract: unknown }).extract = {
      discoverExtractCandidates,
      extractItemCandidate,
    };
    const dispatch = createDomainWireRequestHandler(runtime);

    await expect(
      dispatch(M.discoverExtractCandidates, { itemId: "Inbox/a.md" }),
    ).resolves.toEqual([candidate]);
    expect(discoverExtractCandidates).toHaveBeenCalledWith("Inbox/a.md");

    await expect(
      dispatch(M.extractItemCandidate, {
        itemId: "Inbox/a.md",
        candidate,
      }),
    ).resolves.toEqual({ ok: true });
    expect(extractItemCandidate).toHaveBeenCalledWith("Inbox/a.md", candidate);
    expect(ensureInitialized).toHaveBeenCalledTimes(2);

    await expectBadRequest(() => dispatch(M.discoverExtractCandidates, {}));
    await expectBadRequest(() =>
      dispatch(M.extractItemCandidate, { itemId: "Inbox/a.md" }),
    );
    await expectBadRequest(() =>
      dispatch(M.extractItemCandidate, {
        itemId: "Inbox/a.md",
        candidate: { extractorId: "mock" },
      }),
    );
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

  it("getDerivedCatchUpStatus returns store snapshot (#767)", async () => {
    const status = {
      vaultId: "vault-1",
      status: "running" as const,
      pending: 2,
      running: 1,
    };
    const { runtime, ensureInitialized } = stubRuntime({
      derivedCatchUpStatus: {
        get: vi.fn(() => status),
      },
    });
    const dispatch = createDomainWireRequestHandler(runtime);
    await expect(dispatch(M.getDerivedCatchUpStatus)).resolves.toEqual(status);
    expect(ensureInitialized).toHaveBeenCalled();
  });
});

