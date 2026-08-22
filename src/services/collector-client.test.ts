import { describe, expect, it, vi } from "vitest";
import type { CollectorService } from "@collector/api";
import {
  createDevMockCollectorService,
  createDevMockUiSession,
  createUiDashboardSnapshotPort,
  getCollectorService,
  getUiSession,
  installDevMockCollectorService,
  setCollectorService,
} from "./collector-client";

const PORT_KEYS = [
  "boot",
  "credentials",
  "folders",
  "index",
  "items",
  "jobs",
  "media",
  "settings",
  "syncPlugins",
  "tags",
  "telegramSync",
  "vaults",
] as const;

describe("CollectorService / DevMock (#332 / #365 / #369 / #370)", () => {
  it("installDevMockCollectorService wires getCollectorService; setCollectorService swaps", () => {
    installDevMockCollectorService();
    const original = getCollectorService();
    const originalSession = getUiSession();
    expect(Object.keys(original).sort()).toEqual([...PORT_KEYS].sort());
    expect(typeof original.items.searchItems).toBe("function");

    const stub = {
      items: { searchItems: vi.fn(async () => []) },
    } as unknown as CollectorService;
    const session = createDevMockUiSession(createDevMockCollectorService());
    setCollectorService(stub, session);
    expect(getCollectorService()).toBe(stub);
    expect(getUiSession()).toBe(session);
    setCollectorService(original, originalSession);
    expect(getCollectorService()).toBe(original);
  });

  it("createDevMockCollectorService exposes domain ports (#365 / #30 / #29 / #415)", () => {
    const service = createDevMockCollectorService();
    expect(Object.keys(service).sort()).toEqual([...PORT_KEYS].sort());
    expect(typeof service.items.searchItems).toBe("function");
    expect(typeof service.boot.getDataDirectory).toBe("function");
    expect(typeof service.settings.getAppSettingsSync).toBe("function");
    expect(typeof service.index.getVaultIndexSyncStatus).toBe("function");
    expect(typeof service.index.getDerivedCatchUpStatus).toBe("function");
    expect(typeof service.credentials.getCredentialsAvailability).toBe(
      "function",
    );
    expect(typeof service.syncPlugins.syncNow).toBe("function");
    expect(typeof service.folders.listFolderTree).toBe("function");
    expect(service.folders).not.toHaveProperty("loadFolderTree");
    expect(service.items).not.toHaveProperty("listItems");
  });

  it("createUiDashboardSnapshotPort exposes snapshot methods (#365)", () => {
    const snapshot = createUiDashboardSnapshotPort();
    expect(typeof snapshot.ensureDashboardSnapshot).toBe("function");
    expect(typeof snapshot.peekMatchingDashboardSnapshot).toBe("function");
    expect(typeof snapshot.persistDashboardSnapshot).toBe("function");
    expect(typeof snapshot.clearDashboardSnapshot).toBe("function");
    expect(typeof snapshot.buildDashboardSnapshot).toBe("function");
  });

  it("DevMock exposes queryIndex and hydrate (#362)", async () => {
    const service = createDevMockCollectorService();
    expect(typeof service.items.queryIndex).toBe("function");
    expect(typeof service.items.hydrate).toBe("function");
    const items: unknown[] = [];
    for await (const item of service.items.hydrate([])) {
      items.push(item);
    }
    expect(items).toEqual([]);
  });

  it("createDevMockUiSession wires snapshot, sync settings, thumbnails (#363)", () => {
    const service = createDevMockCollectorService();
    const session = createDevMockUiSession(service);
    expect(Object.keys(session).sort()).toEqual(
      ["settingsSync", "snapshot", "thumbnails"].sort(),
    );
    expect(typeof session.snapshot.ensureDashboardSnapshot).toBe("function");
    expect(typeof session.settingsSync.getAppSettingsSync).toBe("function");
    expect(typeof session.thumbnails.resolveItemThumbnailPath).toBe("function");
    expect(typeof session.thumbnails.resolveItemThumbnailPaths).toBe(
      "function",
    );
    expect(typeof session.thumbnails.resolveItemThumbnailPathsProgressive).toBe(
      "function",
    );
  });

  it("getUiSession tracks setCollectorService (#368/#369)", () => {
    const service = createDevMockCollectorService();
    const session = createDevMockUiSession(service);
    setCollectorService(service, session);
    expect(getUiSession()).toBe(session);
    expect(typeof getUiSession().snapshot.ensureDashboardSnapshot).toBe(
      "function",
    );
    expect(typeof getUiSession().thumbnails.resolveItemThumbnailPaths).toBe(
      "function",
    );
  });

  it("unsupported DevMock writes throw mock-specific error (#332)", async () => {
    const service = createDevMockCollectorService();
    await expect(service.items.searchItems("x", "all")).rejects.toThrow(/#332/);
  });
});
