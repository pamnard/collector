import { describe, expect, it, vi } from "vitest";
import type { HostWireClient } from "@collector/service/wire";
import { createHostDashboardSnapshotPort } from "./dashboard-snapshot.js";
import { createHostThumbnailsPort } from "./thumbnails.js";

function mockTransport(
  requestImpl: (method: string, params?: unknown) => Promise<unknown>,
): HostWireClient {
  return {
    request: vi.fn(async (method, params) => requestImpl(method, params)),
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

describe("createHostDashboardSnapshotPort (#552)", () => {
  it("loads from host ensure and peeks from local cache", async () => {
    const snapshot = {
      schema_version: 2,
      vault_id: "00000000-0000-4000-8000-000000000001",
      nav_filter: "all",
      search: "",
      sort_key: "created_at",
      sort_dir: "desc",
      item_ids: [],
      items: [],
      total_count: 0,
      stream_end_offset: 0,
      cover_paths: {},
      saved_at: "2026-01-01T00:00:00.000Z",
    };
    const transport = mockTransport(async (method) => {
      if (method === "ensureDashboardSnapshot") return snapshot;
      throw new Error(`unexpected ${method}`);
    });
    const port = createHostDashboardSnapshotPort(transport);
    await expect(port.ensureDashboardSnapshot()).resolves.toEqual(snapshot);
    expect(
      port.peekMatchingDashboardSnapshot({
        vaultId: snapshot.vault_id,
        filter: "all",
        search: "",
      }),
    ).toEqual(snapshot);
    expect(transport.request).toHaveBeenCalledTimes(1);
  });

  it("persists via host RPC and updates peek cache", async () => {
    const next = {
      schema_version: 2,
      vault_id: "00000000-0000-4000-8000-000000000002",
      nav_filter: "all",
      search: "q",
      sort_key: "created_at",
      sort_dir: "desc",
      item_ids: [],
      items: [],
      total_count: 0,
      stream_end_offset: 0,
      cover_paths: {},
      saved_at: "2026-01-02T00:00:00.000Z",
    };
    const transport = mockTransport(async (method) => {
      if (method === "persistDashboardSnapshot") return { ok: true };
      throw new Error(`unexpected ${method}`);
    });
    const port = createHostDashboardSnapshotPort(transport);
    await port.persistDashboardSnapshot(next as never);
    expect(transport.request).toHaveBeenCalledWith("persistDashboardSnapshot", {
      snapshot: next,
    });
    expect(
      port.peekMatchingDashboardSnapshot({
        vaultId: next.vault_id,
        filter: "all",
        search: "q",
      }),
    ).toEqual(next);
  });
});

describe("createHostThumbnailsPort (#552)", () => {
  it("maps wire rows to Map and supports progressive emit", async () => {
    const transport = mockTransport(async (method, params) => {
      if (method === "resolveItemThumbnailPaths") {
        const items = (params as { items: Array<{ id: string }> }).items;
        return items.map((item) => ({
          id: item.id,
          path: `/vault/media/${item.id}/cover.webp`,
          width: 640,
          height: 480,
        }));
      }
      throw new Error(`unexpected ${method}`);
    });
    const port = createHostThumbnailsPort(transport);
    const item = { id: "note-1", thumbnail: null } as never;
    const map = await port.resolveItemThumbnailPaths([item]);
    expect(map.get("note-1")).toBe("/vault/media/note-1/cover.webp");

    const progressive: Array<[string, string | null, { width: number; height: number } | null]> =
      [];
    await port.resolveItemThumbnailPathsProgressive([item], {
      onResolved: (id, path, size) => progressive.push([id, path, size]),
    });
    expect(progressive).toEqual([
      ["note-1", "/vault/media/note-1/cover.webp", { width: 640, height: 480 }],
    ]);
  });
});
