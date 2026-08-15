import { describe, expect, it, vi } from "vitest";
import {
  DASHBOARD_HYDRATE_CHUNK_SIZE,
  DASHBOARD_HYDRATE_MAX_IDS,
} from "@collector/api";
import type { HostWireClient } from "@collector/service/wire";
import { createHostSessionCtx } from "../host-session-ctx.js";
import { createHostItemsPort } from "./items.js";

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

describe("createHostItemsPort.hydrate (#666)", () => {
  it("chunks loadDashboardItems and yields in request id order", async () => {
    const ids = Array.from(
      { length: DASHBOARD_HYDRATE_CHUNK_SIZE + 3 },
      (_, i) => `item-${i}.md`,
    );
    const calls: Array<{ itemIds: string[]; offset: number; limit: number }> =
      [];
    const transport = mockTransport(async (method, params) => {
      if (method !== "loadDashboardItems") {
        throw new Error(`unexpected ${method}`);
      }
      const p = params as {
        itemIds: string[];
        offset: number;
        limit: number;
      };
      calls.push(p);
      return p.itemIds.slice(p.offset, p.offset + p.limit).map((id) => ({
        id,
        title: id,
      }));
    });
    const port = createHostItemsPort(createHostSessionCtx(transport));
    const yielded: string[] = [];
    for await (const item of port.hydrate(ids)) {
      yielded.push(item.id);
    }
    expect(calls).toHaveLength(2);
    expect(calls[0]!.itemIds).toEqual(ids.slice(0, DASHBOARD_HYDRATE_CHUNK_SIZE));
    expect(calls[1]!.itemIds).toEqual(ids.slice(DASHBOARD_HYDRATE_CHUNK_SIZE));
    expect(yielded).toEqual(ids);
  });

  it("fail-fast rejects absurd hydrate id lists", async () => {
    const transport = mockTransport(async () => {
      throw new Error("should not call host");
    });
    const port = createHostItemsPort(createHostSessionCtx(transport));
    const ids = Array.from(
      { length: DASHBOARD_HYDRATE_MAX_IDS + 1 },
      (_, i) => `${i}.md`,
    );
    await expect(async () => {
      for await (const _ of port.hydrate(ids)) {
        // drain
      }
    }).rejects.toThrow(/exceeds max/);
    expect(transport.request).not.toHaveBeenCalled();
  });
});
