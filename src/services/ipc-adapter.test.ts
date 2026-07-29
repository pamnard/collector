import { describe, expect, it, vi } from "vitest";
import type { ServiceIpcClient } from "@collector/client";
import {
  createIpcAdapter,
  createIpcCollectorService,
  createIpcDashboardSnapshotPort,
} from "./ipc-adapter";

function mockTransport(
  requestImpl?: (method: string) => Promise<unknown>,
): ServiceIpcClient {
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

describe("createIpcAdapter (#240)", () => {
  it("wraps an injected transport as CollectorClient without Node dialer", async () => {
    const transport = mockTransport(async (method) => {
      if (method === "getDataDirectory") return "/tmp/data";
      throw new Error(`unexpected ${method}`);
    });

    const client = createIpcAdapter(transport);
    await expect(client.getDataDirectory()).resolves.toBe("/tmp/data");
    expect(transport.request).toHaveBeenCalledWith("getDataDirectory");
  });
});

describe("createIpcCollectorService (#366)", () => {
  it("exposes domain ports over the injected transport", async () => {
    const transport = mockTransport(async (method) => {
      if (method === "getDataDirectory") return "/tmp/ports";
      if (method === "listTags") return [];
      throw new Error(`unexpected ${method}`);
    });

    const service = createIpcCollectorService(transport);
    expect(Object.keys(service).sort()).toEqual([
      "boot",
      "folders",
      "index",
      "items",
      "media",
      "settings",
      "tags",
      "vaults",
    ]);
    await expect(service.boot.getDataDirectory()).resolves.toBe("/tmp/ports");
    await expect(service.tags.listTags()).resolves.toEqual([]);
  });

  it("createIpcDashboardSnapshotPort exposes snapshot methods", () => {
    const snapshot = createIpcDashboardSnapshotPort(mockTransport());
    expect(typeof snapshot.ensureDashboardSnapshot).toBe("function");
    expect(typeof snapshot.buildDashboardSnapshot).toBe("function");
  });
});
