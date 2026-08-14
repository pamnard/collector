import { describe, expect, it } from "vitest";
import type { JobPermanentFailure, JobStats } from "@collector/api";
import { SERVICE_HOST_EVENTS } from "@collector/service/wire";
import type { HostWireClient } from "@collector/service/wire";
import { createHostSessionCtx } from "../host-session-ctx.js";
import { createHostJobsPort } from "./jobs.js";

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

describe("createHostJobsPort (#630)", () => {
  it("getJobStats requests wire method", async () => {
    const stats: JobStats = {
      pending: 0,
      running: 0,
      succeeded: 1,
      failed: 0,
      cancelled: 0,
      byType: {},
    };
    const transport = mockTransport(async (method) => {
      expect(method).toBe("getJobStats");
      return stats;
    });
    const port = createHostJobsPort(createHostSessionCtx(transport));
    await expect(port.getJobStats()).resolves.toEqual(stats);
  });

  it("subscribeJobPermanentFailure receives push events", () => {
    const transport = mockTransport();
    const port = createHostJobsPort(createHostSessionCtx(transport));
    const seen: JobPermanentFailure[] = [];
    const sub = port.subscribeJobPermanentFailure((f) => {
      seen.push(f);
    });
    const payload: JobPermanentFailure = {
      id: "j1",
      type: "__test_noop",
      error: "boom",
      attempts: 1,
    };
    transport.emit(SERVICE_HOST_EVENTS.jobPermanentFailure, payload);
    expect(seen).toEqual([payload]);
    sub.unsubscribe();
    transport.emit(SERVICE_HOST_EVENTS.jobPermanentFailure, {
      ...payload,
      id: "j2",
    });
    expect(seen).toHaveLength(1);
  });
});
