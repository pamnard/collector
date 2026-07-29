import { describe, expect, it, vi } from "vitest";
import {
  toCollectorService,
  toUiSession,
  type CollectorServiceApi,
} from "@collector/api";
import {
  createCollectorClient,
  getCollectorClient,
  setCollectorClient,
} from "./collector-client";
import {
  createLocalAdapter,
  createLocalCollectorService,
  createLocalDashboardSnapshotPort,
} from "./local-adapter";

/** Transitional flat checklist (#145); remove with god-interface (#360/#370). */
const REQUIRED_METHODS: (keyof CollectorServiceApi)[] = [
  "openCollectorDatabase",
  "ensureCollectorDatabaseHealthy",
  "ensureActiveVault",
  "getDataDirectory",
  "listItems",
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
  "loadFolderTree",
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

describe("CollectorClient / LocalAdapter (#169 / #365)", () => {
  it("LocalAdapter exposes every CollectorServiceApi method", () => {
    const adapter = createLocalAdapter();
    for (const key of REQUIRED_METHODS) {
      expect(typeof adapter[key], key).toBe("function");
    }
  });

  it("getCollectorClient defaults to LocalAdapter and setCollectorClient swaps", () => {
    const original = getCollectorClient();
    expect(typeof original.listItems).toBe("function");

    const stub = {
      listItems: vi.fn(async () => []),
    } as unknown as CollectorServiceApi;
    setCollectorClient(stub);
    expect(getCollectorClient()).toBe(stub);
    setCollectorClient(original);
    expect(getCollectorClient()).toBe(original);
  });

  it("createCollectorClient returns the provided adapter", () => {
    const adapter = createLocalAdapter();
    expect(createCollectorClient(adapter)).toBe(adapter);
  });

  it("createLocalCollectorService exposes eight domain ports (#365)", () => {
    const service = createLocalCollectorService();
    expect(Object.keys(service).sort()).toEqual([...PORT_KEYS].sort());
    expect(typeof service.items.listItems).toBe("function");
    expect(typeof service.boot.getDataDirectory).toBe("function");
    expect(typeof service.settings.getAppSettingsSync).toBe("function");
    expect(typeof service.index.getVaultIndexSyncStatus).toBe("function");
  });

  it("flat shim delegates to the same port methods (#365)", async () => {
    const service = createLocalCollectorService();
    const flat = createLocalAdapter();
    expect(typeof flat.listItems).toBe("function");
    expect(typeof service.items.listItems).toBe("function");
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
    expect(typeof lifted.items.listItems).toBe("function");
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
});
