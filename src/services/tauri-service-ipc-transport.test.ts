import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import {
  createTauriServiceIpcTransport,
  tauriServiceIpcConnect,
  tauriServiceIpcDisconnect,
  tauriServiceIpcHealth,
  tauriServiceIpcPing,
  tauriServiceIpcRequest,
} from "./tauri-service-ipc-transport";

describe("tauriServiceIpcTransport (#239/#240)", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("connect/request/disconnect use invoke without node net", async () => {
    invoke.mockResolvedValueOnce("/tmp/x.sock");
    await expect(tauriServiceIpcConnect("/tmp/x.sock")).resolves.toBe("/tmp/x.sock");
    expect(invoke).toHaveBeenCalledWith("service_ipc_connect", {
      ipcPath: "/tmp/x.sock",
    });

    invoke.mockResolvedValueOnce({ ok: true, pong: true });
    await expect(tauriServiceIpcPing()).resolves.toEqual({ ok: true, pong: true });

    invoke.mockResolvedValueOnce({
      ok: true,
      status: "healthy",
      open: true,
      healthy: true,
    });
    await expect(tauriServiceIpcHealth()).resolves.toMatchObject({ ok: true });

    invoke.mockResolvedValueOnce("/data");
    await expect(tauriServiceIpcRequest("getDataDirectory")).resolves.toBe("/data");

    invoke.mockResolvedValueOnce(undefined);
    await tauriServiceIpcDisconnect();
    expect(invoke).toHaveBeenCalledWith("service_ipc_disconnect");
  });

  it("createTauriServiceIpcTransport implements ServiceIpcClient", async () => {
    invoke.mockResolvedValueOnce("/tmp/x.sock");
    invoke.mockResolvedValueOnce({ ok: true, pong: true });
    invoke.mockResolvedValueOnce("/data");
    invoke.mockResolvedValueOnce(undefined);

    const transport = await createTauriServiceIpcTransport("/tmp/x.sock");
    await expect(transport.ping()).resolves.toEqual({ ok: true, pong: true });
    await expect(transport.request("getDataDirectory")).resolves.toBe("/data");
    const unsub = transport.onEvent("vaultIndexSyncStatus", () => {});
    unsub();
    await transport.close();
  });
});
