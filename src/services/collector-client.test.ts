import { describe, expect, it, vi } from "vitest";
import type { CollectorServiceApi } from "@collector/api";
import {
  createCollectorClient,
  getCollectorClient,
  setCollectorClient,
} from "./collector-client";
import { createLocalAdapter } from "./local-adapter";

const REQUIRED_METHODS: (keyof CollectorServiceApi)[] = [
  "openCollectorDatabase",
  "ensureCollectorDatabaseHealthy",
  "ensureActiveVault",
  "getDataDirectory",
  "listItems",
  "searchItems",
  "fetchDashboardIndexPage",
  "listDashboardItemIds",
  "subscribeDashboardLoad",
  "streamDashboardItems",
  "loadDashboardItems",
  "getItemById",
  "getItemSource",
  "updateItemSource",
  "createItem",
  "updateItem",
  "deleteItem",
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
});
