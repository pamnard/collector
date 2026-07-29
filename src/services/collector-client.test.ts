import { describe, expect, it, vi } from "vitest";
import type { CollectorService } from "@collector/api";
import {
  getCollectorService,
  getUiSession,
  setCollectorService,
} from "./collector-client";
import {
  createLocalCollectorService,
  createLocalDashboardSnapshotPort,
  createLocalUiSession,
} from "./local-adapter";

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

describe("CollectorService / LocalAdapter (#169 / #365 / #369 / #370)", () => {
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

  it("createLocalDashboardSnapshotPort exposes snapshot methods (#365)", () => {
    const snapshot = createLocalDashboardSnapshotPort();
    expect(typeof snapshot.ensureDashboardSnapshot).toBe("function");
    expect(typeof snapshot.peekMatchingDashboardSnapshot).toBe("function");
    expect(typeof snapshot.persistDashboardSnapshot).toBe("function");
    expect(typeof snapshot.clearDashboardSnapshot).toBe("function");
    expect(typeof snapshot.buildDashboardSnapshot).toBe("function");
  });

  it("LocalAdapter exposes queryIndex and hydrate (#362)", async () => {
    const service = createLocalCollectorService();
    expect(typeof service.items.queryIndex).toBe("function");
    expect(typeof service.items.hydrate).toBe("function");
    const items: unknown[] = [];
    for await (const item of service.items.hydrate([])) {
      items.push(item);
    }
    expect(items).toEqual([]);
  });

  it("createLocalUiSession wires snapshot, sync settings, thumbnails (#363)", () => {
    const service = createLocalCollectorService();
    const session = createLocalUiSession(service);
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
});
