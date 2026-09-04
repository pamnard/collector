/**
 * createHostItemsPort against a real service host (#923).
 * CRUD / search / queryIndex outcomes over HTTP; stream abort is client-local.
 */

import {
  ITEMS_PORT_KEYS,
  type ItemsPort,
} from "@collector/api";
import type { HostWireClient } from "@collector/service/wire";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveServiceHostToken,
  startServiceHost,
} from "@collector/service/host";
import { createCollectorHostService } from "../host-collector-client.js";
import { createHttpHostTransport } from "../http-host-transport.js";
import { createHostSessionCtx } from "../host-session-ctx.js";
import { createHostItemsPort } from "./items.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDataDir(prefix: string): string {
  const dataDir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dataDir);
  return dataDir;
}

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

describe("createHostItemsPort (#923)", () => {
  it("ITEMS_PORT_KEYS are all functions on the port", () => {
    const port = createHostItemsPort(createHostSessionCtx(mockTransport(async () => {
      throw new Error("unused");
    })));
    for (const key of ITEMS_PORT_KEYS) {
      expect(typeof port[key as keyof ItemsPort], key).toBe("function");
    }
  });

  it("create/search/get/update/delete round-trip over startServiceHost wire", { timeout: 60_000 }, async () => {
    const dataDir = tempDataDir("collector-items-port-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const transport = await createHttpHostTransport({
        baseUrl: host.baseUrl,
        token: await resolveServiceHostToken({ dataDir }),
      });
      try {
        const boot = createCollectorHostService(transport);
        await boot.boot.ensureActiveVault();

        const port = createHostItemsPort(createHostSessionCtx(transport));

        const created = await port.createItem({
          title: "port_wire_note_alpha",
          content_type: "note",
          content: "body for search",
        });
        expect(created.title).toBe("port_wire_note_alpha");
        expect(created.id).toBeTruthy();

        await vi.waitFor(
          async () => {
            const indexed = await port.queryIndex("all", undefined, {
              limit: 100,
              offset: 0,
            });
            expect(indexed.ids).toContain(created.id);
          },
          { timeout: 10_000 },
        );

        // FTS lags metadata index — wait for derived + search hit.
        await port.waitDerived(created.id, created.content_revision, {
          timeoutMs: 15_000,
        });
        let searched!: Awaited<ReturnType<typeof port.searchItems>>;
        await vi.waitFor(
          async () => {
            searched = await port.searchItems("port_wire_note_alpha", "all", {
              limit: 24,
              offset: 0,
            });
            expect(
              searched.items.some((item) => item.id === created.id),
            ).toBe(true);
          },
          { timeout: 10_000 },
        );
        expect(
          searched.items.find((item) => item.id === created.id)?.title,
        ).toBe("port_wire_note_alpha");

        const byId = await port.getItemById(created.id);
        expect(byId.item.id).toBe(created.id);
        expect(byId.item.title).toBe("port_wire_note_alpha");

        const updated = await port.updateItem(created.id, {
          title: "port_wire_note_beta",
        });
        expect(updated.title).toBe("port_wire_note_beta");

        const afterUpdate = await port.getItemById(created.id);
        expect(afterUpdate.item.title).toBe("port_wire_note_beta");

        await port.deleteItem(created.id);
        await expect(port.getItemById(created.id)).rejects.toThrow();

        await vi.waitFor(
          async () => {
            const afterDelete = await port.queryIndex("all", undefined, {
              limit: 100,
              offset: 0,
            });
            expect(afterDelete.ids).not.toContain(created.id);
          },
          { timeout: 10_000 },
        );
      } finally {
        await transport.close();
      }
    } finally {
      await host.close();
    }
  });

  it("getItemById rejects unknown ids over startServiceHost wire", async () => {
    const dataDir = tempDataDir("collector-items-port-missing-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const transport = await createHttpHostTransport({
        baseUrl: host.baseUrl,
        token: await resolveServiceHostToken({ dataDir }),
      });
      try {
        const boot = createCollectorHostService(transport);
        await boot.boot.ensureActiveVault();
        const port = createHostItemsPort(createHostSessionCtx(transport));
        await expect(
          port.getItemById("00000000-0000-4000-8000-000000000000.md"),
        ).rejects.toThrow();
      } finally {
        await transport.close();
      }
    } finally {
      await host.close();
    }
  });

  it("streamDashboardItems stops yielding after abort mid-loop", async () => {
    const items = [
      { id: "a.md", title: "A" },
      { id: "b.md", title: "B" },
      { id: "c.md", title: "C" },
    ];
    const transport = mockTransport(async (method) => {
      if (method !== "loadDashboardItems") {
        throw new Error(`unexpected ${method}`);
      }
      return items;
    });
    const port = createHostItemsPort(createHostSessionCtx(transport));
    const controller = new AbortController();
    const seen: string[] = [];

    await port.streamDashboardItems(
      items.map((item) => item.id),
      0,
      items.length,
      (item) => {
        seen.push(item.id);
        if (item.id === "a.md") {
          controller.abort();
        }
      },
      controller.signal,
    );

    expect(seen).toEqual(["a.md"]);
    expect(transport.request).toHaveBeenCalledTimes(1);
  });
});
