import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

const setCollectorClient = vi.fn();
vi.mock("./collector-client", () => ({
  setCollectorClient: (...args: unknown[]) => setCollectorClient(...args),
}));

const getCollectorProfileLayout = vi.fn(async () => ({
  dataDir: "/data",
  configDir: "/config",
  indexDbPath: "/config/../collector.db",
}));
vi.mock("./profile-layout", () => ({
  getCollectorProfileLayout: () => getCollectorProfileLayout(),
}));

const createTauriServiceIpcTransport = vi.fn(async () => ({
  request: vi.fn(),
  ping: vi.fn(),
  health: vi.fn(),
  onEvent: vi.fn(() => () => {}),
  close: vi.fn(),
}));
vi.mock("./tauri-service-ipc-transport", () => ({
  createTauriServiceIpcTransport: (...args: unknown[]) =>
    createTauriServiceIpcTransport(...args),
}));

const createIpcAdapter = vi.fn((transport) => ({ transport, kind: "ipc" }));
vi.mock("./ipc-adapter", () => ({
  createIpcAdapter: (...args: unknown[]) => createIpcAdapter(...args),
}));

import { bootstrapServiceModeCutover } from "./service-mode-bootstrap";

describe("bootstrapServiceModeCutover (#170)", () => {
  beforeEach(() => {
    invoke.mockReset();
    setCollectorClient.mockReset();
    createIpcAdapter.mockClear();
    createTauriServiceIpcTransport.mockClear();
    (globalThis as { window?: { __TAURI_INTERNALS__?: object } }).window = {
      __TAURI_INTERNALS__: {},
    };
  });

  it("swaps CollectorClient when service mode is enabled", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "service_mode_is_enabled") return true;
      if (cmd === "service_mode_bootstrap") return "/tmp/sock";
      throw new Error(cmd);
    });
    await expect(bootstrapServiceModeCutover()).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith("service_mode_bootstrap", {
      dataDir: "/data",
      configDir: "/config",
    });
    expect(createTauriServiceIpcTransport).toHaveBeenCalledWith("/tmp/sock");
    expect(setCollectorClient).toHaveBeenCalled();
  });

  it("keeps LocalAdapter when service mode is disabled", async () => {
    invoke.mockResolvedValueOnce(false);
    await expect(bootstrapServiceModeCutover()).resolves.toBe(false);
    expect(setCollectorClient).not.toHaveBeenCalled();
  });
});
