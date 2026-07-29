import { describe, expect, it, vi } from "vitest";
import {
  toCollectorService,
  toUiSession,
  type CollectorService,
  type CollectorServiceApi,
} from "@collector/api";
import {
  createCollectorClient,
  getCollectorClient,
  getCollectorService,
  getUiSession,
  setCollectorClient,
  setCollectorService,
} from "./collector-client";
import {
  createLocalAdapter,
  createLocalCollectorService,
  createLocalDashboardSnapshotPort,
  createLocalUiSession,
} from "./local-adapter";

/** Transitional flat checklist (#145); remove with god-interface (#360/#370). */
const REQUIRED_METHODS: (keyof CollectorServiceApi)[] = [
  "openCollectorDatabase",
  "ensureCollectorDatabaseHealthy",
  "ensureActiveVault",
  "getDataDirectory",
  "searchItems",
  "queryIndex",
  "hydrate",
  "fetchDashboardIndexPage",
  "listDashboardItemIds",
  "subscribeDashboardLoad",
  "streamDashboardItems",
  "loadDashboardItems",
  "getItemById",
  "getAdjacentItems",
  "getItemSource",
  "updateItemSource",
  "createItem",
  "updateItem",
  "deleteItem",
  "importDroppedFiles",
  "subscribeTags",
  "listTags",
  "createTag",
  "updateTagRecord",
  "deleteTag",
  "subscribeFolderTree",
  "listFolderTree",
  "createFolder",
  "renameFolder",
  "deleteFolder",
  "moveItemToFolderPath",
  "listItemMedia",
  "resolveItemThumbnailPath",
  "resolveItemThumbnailPaths",
  "setItemCoverFromMedia",
  "attachMediaFiles",
  "replaceItemMedia",
  "deleteItemMedia",
  "listVaults",
  "getActiveVaultMeta",
  "switchVault",
  "setDefaultVault",
  "subscribeVaultIndexSyncStatus",
  "getVaultIndexSyncStatus",
  "ensureAppSettings",
  "getAppSettingsSync",
  "updateAppSettings",
  "subscribeAppSettings",
  "getAppConfigDirectory",
  "ensureDashboardSnapshot",
  "peekMatchingDashboardSnapshot",
  "persistDashboardSnapshot",
  "clearDashboardSnapshot",
  "buildDashboardSnapshot",
];

const PORT_KEYS = [
  "boot",
  "folders",
  "index",
  "items",
  "media",
  "settings",
  "tags",
  "vaults",
] as const;

describe("CollectorService / LocalAdapter (#169 / #365 / #369)", () => {
  it("getCollectorService defaults to LocalAdapter ports and setCollectorService swaps", () => {
    const original = getCollectorService();
    const originalSession = getUiSession();
    expect(Object.keys(original).sort()).toEqual([...PORT_KEYS].sort());
    expect(typeof original.items.searchItems).toBe("function");

    const stub = {
      items: { searchItems: vi.fn(async () => []) },
    } as unknown as CollectorService;
    const session = createLocalUiSession(createLocalCollectorService());
    setCollectorService(stub, session);
    expect(getCollectorService()).toBe(stub);
    expect(getUiSession()).toBe(session);
    setCollectorService(original, originalSession);
    expect(getCollectorService()).toBe(original);
  });

  it("createLocalCollectorService exposes eight domain ports (#365)", () => {
    const service = createLocalCollectorService();
    expect(Object.keys(service).sort()).toEqual([...PORT_KEYS].sort());
    expect(typeof service.items.searchItems).toBe("function");
    expect(typeof service.boot.getDataDirectory).toBe("function");
    expect(typeof service.settings.getAppSettingsSync).toBe("function");
    expect(typeof service.index.getVaultIndexSyncStatus).toBe("function");
    expect(typeof service.folders.listFolderTree).toBe("function");
    expect(service.folders).not.toHaveProperty("loadFolderTree");
    expect(service.items).not.toHaveProperty("listItems");
  });

  it("flat shim still composes until #370", () => {
    const adapter = createLocalAdapter();
    for (const key of REQUIRED_METHODS) {
      expect(typeof adapter[key], key).toBe("function");
    }
    expect(
      typeof (adapter as { listItems?: unknown }).listItems,
    ).not.toBe("function");
    expect(
      typeof (adapter as { loadFolderTree?: unknown }).loadFolderTree,
    ).not.toBe("function");
  });

  it("getCollectorClient flat shim exposes port methods (#369)", () => {
    const flat = getCollectorClient();
    expect(typeof flat.searchItems).toBe("function");
    expect(typeof flat.listFolderTree).toBe("function");
    expect(typeof (flat as { listItems?: unknown }).listItems).not.toBe(
      "function",
    );
    expect(
      typeof (flat as { loadFolderTree?: unknown }).loadFolderTree,
    ).not.toBe("function");
  });

  it("createCollectorClient returns the provided adapter", () => {
    const adapter = createLocalAdapter();
    expect(createCollectorClient(adapter)).toBe(adapter);
  });

  it("flat shim delegates to the same port methods (#365)", async () => {
    const service = createLocalCollectorService();
    const flat = createLocalAdapter();
    expect(typeof flat.searchItems).toBe("function");
    expect(typeof service.items.searchItems).toBe("function");
    expect(typeof flat.getDataDirectory).toBe("function");
    expect(typeof service.boot.getDataDirectory).toBe("function");

    const fromPort: unknown[] = [];
    for await (const item of service.items.hydrate([])) {
      fromPort.push(item);
    }
    const fromFlat: unknown[] = [];
    for await (const item of flat.hydrate([])) {
      fromFlat.push(item);
    }
    expect(fromPort).toEqual([]);
    expect(fromFlat).toEqual([]);
  });

  it("toCollectorService(flat) matches createLocalCollectorService keys (#361/#365)", () => {
    const native = createLocalCollectorService();
    const lifted = toCollectorService(createLocalAdapter());
    expect(Object.keys(lifted).sort()).toEqual(Object.keys(native).sort());
    expect(typeof lifted.items.searchItems).toBe("function");
    expect(typeof lifted.boot.getDataDirectory).toBe("function");
    expect(typeof lifted.settings.getAppSettingsSync).toBe("function");
  });

  it("createLocalDashboardSnapshotPort exposes snapshot methods (#365)", () => {
    const snapshot = createLocalDashboardSnapshotPort();
    expect(typeof snapshot.ensureDashboardSnapshot).toBe("function");
    expect(typeof snapshot.peekMatchingDashboardSnapshot).toBe("function");
    expect(typeof snapshot.persistDashboardSnapshot).toBe("function");
    expect(typeof snapshot.clearDashboardSnapshot).toBe("function");
    expect(typeof snapshot.buildDashboardSnapshot).toBe("function");
  });

  it("LocalAdapter exposes queryIndex and hydrate (#362)", async () => {
    const adapter = createLocalAdapter();
    expect(typeof adapter.queryIndex).toBe("function");
    expect(typeof adapter.hydrate).toBe("function");
    const items: unknown[] = [];
    for await (const item of adapter.hydrate([])) {
      items.push(item);
    }
    expect(items).toEqual([]);
  });

  it("toUiSession lifts snapshot, sync settings, thumbnails (#363)", () => {
    const adapter = createLocalAdapter();
    const session = toUiSession(adapter);
    expect(Object.keys(session).sort()).toEqual(
      ["settingsSync", "snapshot", "thumbnails"].sort(),
    );
    expect(typeof session.snapshot.ensureDashboardSnapshot).toBe("function");
    expect(typeof session.settingsSync.getAppSettingsSync).toBe("function");
    expect(typeof session.thumbnails.resolveItemThumbnailPath).toBe("function");
    expect(typeof session.thumbnails.resolveItemThumbnailPaths).toBe(
      "function",
    );
  });

  it("getUiSession tracks setCollectorService (#368/#369)", () => {
    const original = getCollectorService();
    const originalSession = getUiSession();
    const service = createLocalCollectorService();
    const session = createLocalUiSession(service);
    setCollectorService(service, session);
    expect(getUiSession()).toBe(session);
    expect(typeof getUiSession().snapshot.ensureDashboardSnapshot).toBe(
      "function",
    );
    expect(typeof getUiSession().thumbnails.resolveItemThumbnailPaths).toBe(
      "function",
    );
    expect(typeof getUiSession().settingsSync.getAppSettingsSync).toBe(
      "function",
    );
    setCollectorService(original, originalSession);
  });

  it("setCollectorClient still lifts flat into ports (#369 transitional)", () => {
    const original = getCollectorService();
    const originalSession = getUiSession();
    const adapter = createLocalAdapter();
    setCollectorClient(adapter);
    expect(typeof getCollectorService().items.searchItems).toBe("function");
    expect(typeof getUiSession().snapshot.ensureDashboardSnapshot).toBe(
      "function",
    );
    setCollectorService(original, originalSession);
  });
});
