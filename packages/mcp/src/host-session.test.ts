/**
 * MCP host session auth refresh (#826).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { HostWireError } from "@collector/service/host";
import type { CollectorHostServiceClient } from "@collector/client";

const createHttpHostTransport = vi.fn();
const createCollectorHostServiceClient = vi.fn();
const resolveMcpHostEndpoint = vi.fn();

vi.mock("@collector/client", () => ({
  createHttpHostTransport: (...args: unknown[]) =>
    createHttpHostTransport(...args),
  createCollectorHostServiceClient: (...args: unknown[]) =>
    createCollectorHostServiceClient(...args),
}));

vi.mock("./endpoint.js", async () => {
  const actual = await vi.importActual<typeof import("./endpoint.js")>(
    "./endpoint.js",
  );
  return {
    ...actual,
    resolveMcpHostEndpoint: (...args: unknown[]) =>
      resolveMcpHostEndpoint(...args),
  };
});

import {
  createMcpHostSession,
  createStaticMcpHostSession,
  formatMcpAuthFailure,
  isAuthFailedError,
} from "./host-session.js";

function authFailed(message = "Bearer authentication failed") {
  return new HostWireError({
    layer: "auth",
    code: "auth_failed",
    message,
  });
}

function mockClient(overrides: Partial<CollectorHostServiceClient> = {}) {
  return {
    health: vi.fn(),
    close: vi.fn(async () => undefined),
    items: {},
    ...overrides,
  } as unknown as CollectorHostServiceClient;
}

describe("McpHostSession (#826)", () => {
  beforeEach(() => {
    createHttpHostTransport.mockReset();
    createCollectorHostServiceClient.mockReset();
    resolveMcpHostEndpoint.mockReset();
  });

  it("withAuthRetry refreshes data-dir credentials once on auth_failed", async () => {
    const dataDir = "/tmp/collector-mcp-session-test";
    resolveMcpHostEndpoint
      .mockResolvedValueOnce({
        baseUrl: "http://127.0.0.1:1",
        token: "old",
        dataDir,
      })
      .mockResolvedValueOnce({
        baseUrl: "http://127.0.0.1:1",
        token: "new",
        dataDir,
      });

    const stale = mockClient({
      health: vi.fn().mockRejectedValue(authFailed()),
    });
    const fresh = mockClient({
      health: vi.fn().mockResolvedValue({ ok: true, healthy: true }),
    });

    createHttpHostTransport
      .mockResolvedValueOnce({ close: vi.fn() })
      .mockResolvedValueOnce({ close: vi.fn() });
    createCollectorHostServiceClient
      .mockReturnValueOnce(stale)
      .mockReturnValueOnce(fresh);

    const session = await createMcpHostSession({ dataDir });
    expect(session.canRefreshFromDataDir).toBe(true);

    const result = await session.withAuthRetry((client) => client.health());
    expect(result).toEqual({ ok: true, healthy: true });
    expect(stale.health).toHaveBeenCalledTimes(1);
    expect(fresh.health).toHaveBeenCalledTimes(1);
    expect(resolveMcpHostEndpoint).toHaveBeenCalledTimes(2);
    expect(createHttpHostTransport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ token: "new" }),
    );
    expect(stale.close).toHaveBeenCalled();
  });

  it("pinned --token does not re-read data-dir on auth_failed", async () => {
    resolveMcpHostEndpoint.mockResolvedValue({
      baseUrl: "http://127.0.0.1:1",
      token: "pinned",
      dataDir: "/tmp/ignored",
    });
    createHttpHostTransport.mockResolvedValue({ close: vi.fn() });
    const client = mockClient({
      health: vi.fn().mockRejectedValue(authFailed()),
    });
    createCollectorHostServiceClient.mockReturnValue(client);

    const session = await createMcpHostSession({
      baseUrl: "http://127.0.0.1:1",
      token: "pinned",
      dataDir: "/tmp/ignored",
    });
    expect(session.canRefreshFromDataDir).toBe(false);

    await expect(
      session.withAuthRetry((c) => c.health()),
    ).rejects.toMatchObject({ code: "auth_failed" });
    expect(resolveMcpHostEndpoint).toHaveBeenCalledTimes(1);
    expect(createHttpHostTransport).toHaveBeenCalledTimes(1);
  });

  it("static session never refreshes", async () => {
    const client = mockClient({
      health: vi.fn().mockRejectedValue(authFailed()),
    });
    const session = createStaticMcpHostSession(client);
    expect(session.canRefreshFromDataDir).toBe(false);
    await expect(
      session.withAuthRetry((c) => c.health()),
    ).rejects.toMatchObject({ code: "auth_failed" });
    await expect(session.refreshFromDataDir()).rejects.toThrow(/pinned|cannot refresh/i);
  });

  it("formats auth failure with data-dir hint", () => {
    const refreshable = {
      canRefreshFromDataDir: true,
      endpointArgs: { dataDir: "/data" },
      getEndpoint: () => ({
        baseUrl: "http://127.0.0.1:9",
        token: "stale",
        dataDir: "/data",
      }),
    };
    const message = formatMcpAuthFailure(authFailed(), refreshable);
    expect(message).toMatch(/auth_failed/);
    expect(message).toMatch(/collector-service\.host-token/);
    expect(message).toMatch(/fresh token/i);
  });

  it("isAuthFailedError detects HostWireError auth_failed", () => {
    expect(isAuthFailedError(authFailed())).toBe(true);
    expect(isAuthFailedError(new Error("Bearer authentication failed"))).toBe(
      false,
    );
  });
});
