import { describe, expect, it, vi } from "vitest";
import { hostWireError, type HostWireClient } from "@collector/service/wire";
import { createHostThumbnailsPort } from "./thumbnails.js";

function mockTransport(
  requestImpl: (
    method: string,
    params?: unknown,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>,
): HostWireClient {
  return {
    request: vi.fn(async (method, params, options) =>
      requestImpl(method, params, options),
    ),
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

describe("createHostThumbnailsPort progressive wire (#823)", () => {
  it("emits onResolved for a fast id before the last item in a multi-item batch completes", async () => {
    let releaseSlow: (() => void) | undefined;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    let slowStarted = false;

    const transport = mockTransport(async (method, params) => {
      if (method !== "resolveItemThumbnailPaths") {
        throw new Error(`unexpected ${method}`);
      }
      const items = (params as { items: Array<{ id: string }> }).items;
      expect(items).toHaveLength(1);
      const id = items[0]!.id;
      if (id === "slow") {
        slowStarted = true;
        await slowGate;
      }
      return [
        {
          id,
          path: `/vault/media/${id}/cover.webp`,
          width: 100,
          height: 80,
        },
      ];
    });

    const port = createHostThumbnailsPort(transport);
    const order: string[] = [];
    const run = port.resolveItemThumbnailPathsProgressive(
      [
        { id: "slow", thumbnail: null },
        { id: "fast", thumbnail: null },
      ] as never,
      {
        concurrency: 2,
        onResolved: (id) => {
          order.push(id);
          if (id === "fast") {
            expect(slowStarted).toBe(true);
            releaseSlow?.();
          }
        },
      },
    );

    await run;
    expect(order[0]).toBe("fast");
    expect(order).toEqual(["fast", "slow"]);
    expect(transport.request).toHaveBeenCalledTimes(2);
  });

  it("does not emit after abort and settles without unrecovered throw", async () => {
    const controller = new AbortController();
    let releaseSlow: (() => void) | undefined;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });

    const transport = mockTransport(async (method, params, options) => {
      if (method !== "resolveItemThumbnailPaths") {
        throw new Error(`unexpected ${method}`);
      }
      const items = (params as { items: Array<{ id: string }> }).items;
      const id = items[0]!.id;
      if (id === "slow") {
        await slowGate;
        if (options?.signal?.aborted) {
          throw hostWireError({
            layer: "transport",
            code: "cancelled",
            message: "RPC cancelled",
          });
        }
      }
      return [
        {
          id,
          path: `/vault/${id}.webp`,
          width: 10,
          height: 10,
        },
      ];
    });

    const port = createHostThumbnailsPort(transport);
    const emitted: string[] = [];
    const run = port.resolveItemThumbnailPathsProgressive(
      [
        { id: "slow", thumbnail: null },
        { id: "after-abort", thumbnail: null },
      ] as never,
      {
        concurrency: 1,
        signal: controller.signal,
        onResolved: (id) => {
          emitted.push(id);
        },
      },
    );

    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    releaseSlow?.();
    await run;

    expect(emitted).toEqual([]);
    // concurrency 1: slow was in-flight; after-abort never started (#823 holes → UI flight).
    expect(transport.request).toHaveBeenCalledTimes(1);
  });

  it("passes AbortSignal through to each wire request", async () => {
    const controller = new AbortController();
    const seenSignals: Array<AbortSignal | undefined> = [];
    const transport = mockTransport(async (method, params, options) => {
      seenSignals.push(options?.signal);
      const items = (params as { items: Array<{ id: string }> }).items;
      return items.map((item) => ({
        id: item.id,
        path: null,
        width: null,
        height: null,
      }));
    });

    const port = createHostThumbnailsPort(transport);
    await port.resolveItemThumbnailPathsProgressive(
      [
        { id: "a", thumbnail: null },
        { id: "b", thumbnail: null },
      ] as never,
      {
        concurrency: 1,
        signal: controller.signal,
        onResolved: () => {},
      },
    );

    expect(seenSignals).toHaveLength(2);
    expect(seenSignals.every((signal) => signal === controller.signal)).toBe(
      true,
    );
  });
});
