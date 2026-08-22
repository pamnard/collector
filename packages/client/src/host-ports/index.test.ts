import { describe, expect, it } from "vitest";
import type { DerivedCatchUpStatus } from "@collector/api";
import { SERVICE_HOST_EVENTS } from "@collector/service/wire";
import type { HostWireClient } from "@collector/service/wire";
import { createHostSessionCtx } from "../host-session-ctx.js";
import { createHostIndexPort } from "./index.js";

function mockTransport(
  requestImpl?: (method: string, params?: unknown) => Promise<unknown>,
): HostWireClient & {
  emit: (event: string, payload: unknown) => void;
} {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  return {
    request: async (method, params) => {
      if (requestImpl) {
        return requestImpl(method, params);
      }
      throw new Error(`unexpected ${method}`);
    },
    ping: async () => ({ ok: true as const, pong: true as const }),
    health: async () => ({
      ok: true,
      status: "healthy" as const,
      open: true,
      healthy: true,
    }),
    onEvent: (event, handler) => {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(handler);
      return () => {
        set?.delete(handler);
      };
    },
    close: async () => {},
    emit(event, payload) {
      for (const handler of listeners.get(event) ?? []) {
        handler(payload);
      }
    },
  };
}

describe("createHostIndexPort derived catch-up (#767)", () => {
  it("getDerivedCatchUpStatus returns cached status", () => {
    const transport = mockTransport();
    const ctx = createHostSessionCtx(transport);
    ctx.cachedDerivedCatchUpStatus = {
      vaultId: "v1",
      status: "running",
      pending: 1,
      running: 0,
    };
    const port = createHostIndexPort(ctx);
    expect(port.getDerivedCatchUpStatus()).toEqual(ctx.cachedDerivedCatchUpStatus);
  });

  it("subscribeDerivedCatchUpStatus receives push events", () => {
    const transport = mockTransport();
    const port = createHostIndexPort(createHostSessionCtx(transport));
    const seen: DerivedCatchUpStatus[] = [];
    const sub = port.subscribeDerivedCatchUpStatus((status) => {
      seen.push(status);
    });
    const payload: DerivedCatchUpStatus = {
      vaultId: "v1",
      status: "running",
      pending: 2,
      running: 0,
    };
    transport.emit(SERVICE_HOST_EVENTS.derivedCatchUpStatus, payload);
    expect(seen).toContainEqual(payload);
    sub.unsubscribe();
    const before = seen.length;
    transport.emit(SERVICE_HOST_EVENTS.derivedCatchUpStatus, {
      ...payload,
      pending: 0,
      status: "idle",
    });
    expect(seen).toHaveLength(before);
  });
});
