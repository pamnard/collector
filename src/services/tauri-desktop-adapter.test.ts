import { describe, expect, it, vi } from "vitest";
import type { HostWireClient } from "@collector/client";
import {
  createTauriDesktopCollectorService,
  createTauriDesktopDashboardSnapshotPort,
  createTauriDesktopUiSession,
} from "./tauri-desktop-adapter";

function mockTransport(
  requestImpl?: (method: string) => Promise<unknown>,
): HostWireClient {
  return {
    request: vi.fn(async (method) => {
      if (requestImpl) {
        return requestImpl(method);
      }
      throw new Error(`unexpected ${method}`);
    }),
    ping: vi.fn(async () => ({ ok: true as const, pong: true as const })),
    health: vi.fn(async () => ({
      ok: true,
      status: "healthy" as const,
      open: true,
      healthy: true,
    })),
    onEvent: vi.fn(() => () => {}),
    close: vi.fn(async () => {}),
  };
}

describe("createTauriDesktopCollectorService (#366 / #370)", () => {
  it("exposes domain ports over the injected transport", async () => {
    const transport = mockTransport(async (method) => {
      if (method === "getDataDirectory") return "/tmp/ports";
      if (method === "listTags") return [];
      throw new Error(`unexpected ${method}`);
    });

    const service = createTauriDesktopCollectorService(transport);
    expect(Object.keys(service).sort()).toEqual([
      "boot",
      "credentials",
      "folders",
      "index",
      "items",
      "media",
      "settings",
      "syncPlugins",
      "tags",
      "telegramSync",
      "vaults",
    ]);
    await expect(service.boot.getDataDirectory()).resolves.toBe("/tmp/ports");
    await expect(service.tags.listTags()).resolves.toEqual([]);
  });

  it("createTauriDesktopDashboardSnapshotPort uses local FS port (#368)", () => {
    const snapshot = createTauriDesktopDashboardSnapshotPort(mockTransport());
    expect(typeof snapshot.ensureDashboardSnapshot).toBe("function");
    expect(typeof snapshot.buildDashboardSnapshot).toBe("function");
    expect(typeof snapshot.persistDashboardSnapshot).toBe("function");
  });

  it("createTauriDesktopUiSession wires local snapshot/thumbnails (#369)", () => {
    const transport = mockTransport();
    const service = createTauriDesktopCollectorService(transport);
    const session = createTauriDesktopUiSession(transport, service);
    expect(typeof session.snapshot.ensureDashboardSnapshot).toBe("function");
    expect(typeof session.thumbnails.resolveItemThumbnailPaths).toBe(
      "function",
    );
    expect(typeof session.thumbnails.resolveItemThumbnailPathsProgressive).toBe(
      "function",
    );
    expect(typeof session.settingsSync.getAppSettingsSync).toBe("function");
  });

  it("UiSession snapshot/thumbnails do not RPC (#368)", async () => {
    const transport = mockTransport(async (method) => {
      throw new Error(`unexpected ${method}`);
    });
    const service = createTauriDesktopCollectorService(transport);
    const session = createTauriDesktopUiSession(transport, service);
    const snap = session.snapshot.buildDashboardSnapshot({
      vaultId: "00000000-0000-4000-8000-000000000001",
      filter: "all",
      search: "",
      itemIds: [],
      items: [],
      totalCount: 0,
      streamEndOffset: 0,
    });
    expect(snap.vault_id).toBe("00000000-0000-4000-8000-000000000001");
    await expect(
      session.thumbnails.resolveItemThumbnailPaths([]),
    ).resolves.toEqual(new Map());
    expect(transport.request).not.toHaveBeenCalled();
  });
});
