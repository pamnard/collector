import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const listen = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listen(...args),
}));

import {
  createTauriHostWireTransport,
  TAURI_HOST_WIRE_EVENT,
  tauriHostWireConnect,
  tauriHostWireDisconnect,
  tauriHostWireHealth,
  tauriHostWirePing,
  tauriHostWireRequest,
} from "./tauri-host-transport";

describe("tauriHostWireTransport (#239/#240/#329)", () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
    listen.mockResolvedValue(() => {});
  });

  it("connect/request/disconnect use invoke without node net", async () => {
    invoke.mockResolvedValueOnce("/tmp/x.sock");
    await expect(tauriHostWireConnect("/tmp/x.sock", "/data")).resolves.toBe(
      "/tmp/x.sock",
    );
    expect(invoke).toHaveBeenCalledWith("service_ipc_connect", {
      ipcPath: "/tmp/x.sock",
      dataDir: "/data",
    });

    invoke.mockResolvedValueOnce({ ok: true, pong: true });
    await expect(tauriHostWirePing()).resolves.toEqual({ ok: true, pong: true });

    invoke.mockResolvedValueOnce({
      ok: true,
      status: "healthy",
      open: true,
      healthy: true,
    });
    await expect(tauriHostWireHealth()).resolves.toMatchObject({ ok: true });

    invoke.mockResolvedValueOnce("/data");
    await expect(tauriHostWireRequest("getDataDirectory")).resolves.toBe("/data");

    invoke.mockResolvedValueOnce(undefined);
    await tauriHostWireDisconnect();
    expect(invoke).toHaveBeenCalledWith("service_ipc_disconnect");
  });

  it("createTauriHostWireTransport onEvent listens for host push", async () => {
    invoke.mockResolvedValueOnce("/tmp/x.sock");
    invoke.mockResolvedValueOnce({ ok: true, pong: true });
    invoke.mockResolvedValueOnce("/data");
    invoke.mockResolvedValueOnce(undefined);

    let eventHandler:
      | ((event: { payload: { event: string; payload: unknown } }) => void)
      | null = null;
    const unlisten = vi.fn();
    listen.mockImplementation(async (_name: string, handler: typeof eventHandler) => {
      eventHandler = handler;
      return unlisten;
    });

    const transport = await createTauriHostWireTransport("/tmp/x.sock", "/data");
    await expect(transport.ping()).resolves.toEqual({ ok: true, pong: true });
    await expect(transport.request("getDataDirectory")).resolves.toBe("/data");

    const seen: unknown[] = [];
    const unsub = transport.onEvent("vaultIndexSyncStatus", (payload) => {
      seen.push(payload);
    });
    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalledWith(
        TAURI_HOST_WIRE_EVENT,
        expect.any(Function),
      );
    });
    eventHandler?.({
      payload: {
        event: "vaultIndexSyncStatus",
        payload: { status: "running" },
      },
    });
    expect(seen).toEqual([{ status: "running" }]);
    unsub();
    await transport.close();
    expect(unlisten).toHaveBeenCalled();
  });
});
