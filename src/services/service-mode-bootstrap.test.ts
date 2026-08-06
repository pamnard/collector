import { beforeEach, describe, expect, it, vi } from "vitest";

const setCollectorService = vi.fn();
vi.mock("./collector-client", () => ({
  setCollectorService: (...args: unknown[]) => setCollectorService(...args),
}));

const createHttpUiCutover = vi.fn(async () => ({
  service: { kind: "http-service" },
  session: { kind: "http-session" },
  transport: { kind: "http-transport" },
}));
vi.mock("./http-adapter", () => ({
  createHttpUiCutover: (...args: unknown[]) => createHttpUiCutover(...args),
}));

const setHostMediaCredentials = vi.fn();
vi.mock("../utils/asset-src", () => ({
  setHostMediaCredentials: (...args: unknown[]) =>
    setHostMediaCredentials(...args),
}));

import { bootstrapServiceModeCutover } from "./service-mode-bootstrap";

describe("bootstrapServiceModeCutover (#551 / #555)", () => {
  const env = import.meta.env as {
    VITE_COLLECTOR_SERVICE_BASE_URL?: string;
    VITE_COLLECTOR_SERVICE_TOKEN?: string;
  };

  beforeEach(() => {
    setCollectorService.mockReset();
    createHttpUiCutover.mockClear();
    setHostMediaCredentials.mockClear();
    delete env.VITE_COLLECTOR_SERVICE_BASE_URL;
    delete env.VITE_COLLECTOR_SERVICE_TOKEN;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
  });

  it("returns web when Vite host env empty and bootstrap missing", async () => {
    await expect(bootstrapServiceModeCutover()).resolves.toBe("web");
    expect(setCollectorService).not.toHaveBeenCalled();
    expect(createHttpUiCutover).not.toHaveBeenCalled();
  });

  it("installs HTTP host when both Vite env vars are set (#551)", async () => {
    env.VITE_COLLECTOR_SERVICE_BASE_URL = "http://127.0.0.1:9876";
    env.VITE_COLLECTOR_SERVICE_TOKEN = "test-token";
    await expect(bootstrapServiceModeCutover()).resolves.toBe("host");
    expect(createHttpUiCutover).toHaveBeenCalledWith(
      "http://127.0.0.1:9876",
      "test-token",
    );
    expect(setHostMediaCredentials).toHaveBeenCalledWith(
      "http://127.0.0.1:9876",
      "test-token",
    );
    expect(setCollectorService).toHaveBeenCalled();
  });

  it("fails fast when exactly one Vite host env is set (#551)", async () => {
    env.VITE_COLLECTOR_SERVICE_BASE_URL = "http://127.0.0.1:9876";
    await expect(bootstrapServiceModeCutover()).rejects.toThrow(/#551/);
    expect(setCollectorService).not.toHaveBeenCalled();
  });

  it("installs HTTP host from /api/ui-bootstrap (#555)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          baseUrl: "http://127.0.0.1:4455",
          token: "boot-token",
          wsEventsUrl: "ws://127.0.0.1:4455/api/events",
        }),
      ),
    );
    await expect(bootstrapServiceModeCutover()).resolves.toBe("host");
    expect(createHttpUiCutover).toHaveBeenCalledWith(
      "http://127.0.0.1:4455",
      "boot-token",
    );
    expect(setHostMediaCredentials).toHaveBeenCalledWith(
      "http://127.0.0.1:4455",
      "boot-token",
    );
    expect(setCollectorService).toHaveBeenCalled();
  });

  it("fails loudly when ui-bootstrap returns non-404 error (#555)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    await expect(bootstrapServiceModeCutover()).rejects.toThrow(/ui-bootstrap/);
    expect(setCollectorService).not.toHaveBeenCalled();
  });
});
