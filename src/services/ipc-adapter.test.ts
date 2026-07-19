import { describe, expect, it, vi } from "vitest";
import type { ServiceIpcClient } from "@collector/client";
import { createIpcAdapter } from "./ipc-adapter";

describe("createIpcAdapter (#240)", () => {
  it("wraps an injected transport as CollectorClient without Node dialer", async () => {
    const transport: ServiceIpcClient = {
      request: vi.fn(async (method) => {
        if (method === "getDataDirectory") return "/tmp/data";
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

    const client = createIpcAdapter(transport);
    await expect(client.getDataDirectory()).resolves.toBe("/tmp/data");
    expect(transport.request).toHaveBeenCalledWith("getDataDirectory");
  });
});
