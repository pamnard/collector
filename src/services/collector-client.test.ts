import { describe, expect, it, vi } from "vitest";
import {
  toCollectorService,
  type CollectorServiceApi,
} from "@collector/api";
import {
  createCollectorClient,
  getCollectorClient,
  setCollectorClient,
} from "./collector-client";
import { createLocalAdapter } from "./local-adapter";

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

describe("CollectorClient / LocalAdapter (#169)", () => {
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

  it("toCollectorService lifts LocalAdapter into eight ports (#361)", () => {
    const adapter = createLocalAdapter();
    const service = toCollectorService(adapter);
    expect(Object.keys(service).sort()).toEqual(
      [
        "boot",
        "folders",
        "index",
        "items",
        "media",
        "settings",
        "tags",
        "vaults",
      ].sort(),
    );
    expect(typeof service.items.listItems).toBe("function");
    expect(typeof service.boot.getDataDirectory).toBe("function");
    expect(typeof service.settings.getAppSettingsSync).toBe("function");
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
});
