import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

const setCollectorService = vi.fn();
vi.mock("./collector-client", () => ({
  setCollectorService: (...args: unknown[]) => setCollectorService(...args),
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

const createIpcCollectorService = vi.fn((transport) => ({
  transport,
  kind: "ipc-service",
}));
const createIpcUiSession = vi.fn((_transport, service) => ({
  service,
  kind: "ipc-session",
}));
vi.mock("./ipc-adapter", () => ({
  createIpcCollectorService: (...args: unknown[]) =>
    createIpcCollectorService(...args),
  createIpcUiSession: (...args: unknown[]) => createIpcUiSession(...args),
}));

const createHttpUiCutover = vi.fn(async () => ({
  service: { kind: "http-service" },
  session: { kind: "http-session" },
  transport: { kind: "http-transport" },
}));
vi.mock("./http-adapter", () => ({
  createHttpUiCutover: (...args: unknown[]) => createHttpUiCutover(...args),
}));

import { bootstrapServiceModeCutover } from "./service-mode-bootstrap";

describe("bootstrapServiceModeCutover (#170 / #332 / #369 / #551)", () => {
  const env = import.meta.env as {
    VITE_COLLECTOR_SERVICE_BASE_URL?: string;
    VITE_COLLECTOR_SERVICE_TOKEN?: string;
  };

  beforeEach(() => {
    invoke.mockReset();
    setCollectorService.mockReset();
    createIpcCollectorService.mockClear();
    createIpcUiSession.mockClear();
    createTauriServiceIpcTransport.mockClear();
    createHttpUiCutover.mockClear();
    delete env.VITE_COLLECTOR_SERVICE_BASE_URL;
    delete env.VITE_COLLECTOR_SERVICE_TOKEN;
    (globalThis as { window?: { __TAURI_INTERNALS__?: object } }).window = {
      __TAURI_INTERNALS__: {},
    };
  });

  it("swaps CollectorService when service mode is enabled", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "service_mode_is_enabled") return true;
      if (cmd === "service_mode_bootstrap") return "/tmp/sock";
      throw new Error(cmd);
    });
    await expect(bootstrapServiceModeCutover()).resolves.toBe("ipc");
    expect(invoke).toHaveBeenCalledWith("service_mode_bootstrap", {
      dataDir: "/data",
      configDir: "/config",
    });
    expect(createTauriServiceIpcTransport).toHaveBeenCalledWith(
      "/tmp/sock",
      "/data",
    );
    expect(createIpcCollectorService).toHaveBeenCalled();
    expect(createIpcUiSession).toHaveBeenCalled();
    expect(setCollectorService).toHaveBeenCalled();
  });

  it("throws when service mode is disabled (#332)", async () => {
    invoke.mockResolvedValueOnce(false);
    await expect(bootstrapServiceModeCutover()).rejects.toThrow(/#332/);
    expect(setCollectorService).not.toHaveBeenCalled();
  });

  it("returns web when not running under Tauri and Vite host env empty", async () => {
    delete (globalThis as { window?: unknown }).window;
    await expect(bootstrapServiceModeCutover()).resolves.toBe("web");
    expect(setCollectorService).not.toHaveBeenCalled();
    expect(createHttpUiCutover).not.toHaveBeenCalled();
  });

  it("installs HTTP host when both Vite env vars are set (#551)", async () => {
    delete (globalThis as { window?: unknown }).window;
    env.VITE_COLLECTOR_SERVICE_BASE_URL = "http://127.0.0.1:9876";
    env.VITE_COLLECTOR_SERVICE_TOKEN = "test-token";
    await expect(bootstrapServiceModeCutover()).resolves.toBe("host");
    expect(createHttpUiCutover).toHaveBeenCalledWith(
      "http://127.0.0.1:9876",
      "test-token",
    );
    expect(setCollectorService).toHaveBeenCalled();
  });

  it("fails fast when exactly one Vite host env is set (#551)", async () => {
    delete (globalThis as { window?: unknown }).window;
    env.VITE_COLLECTOR_SERVICE_BASE_URL = "http://127.0.0.1:9876";
    await expect(bootstrapServiceModeCutover()).rejects.toThrow(/#551/);
    expect(setCollectorService).not.toHaveBeenCalled();
  });
});
