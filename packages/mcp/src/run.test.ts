import { beforeEach, describe, expect, it, vi } from "vitest";
import { HostWireError } from "@collector/service/host";

const createHttpHostTransport = vi.fn();
const createCollectorHostServiceClient = vi.fn();

vi.mock("@collector/client", () => ({
  createHttpHostTransport: (...args: unknown[]) =>
    createHttpHostTransport(...args),
  createCollectorHostServiceClient: (...args: unknown[]) =>
    createCollectorHostServiceClient(...args),
}));

vi.mock("./server.js", () => ({
  createCollectorMcpServer: () => ({
    connect: vi.fn(async () => undefined),
  }),
}));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {
    constructor() {}
  },
}));

import { runCollectorMcp } from "./run.js";

describe("runCollectorMcp (#556)", () => {
  beforeEach(() => {
    createHttpHostTransport.mockReset();
    createCollectorHostServiceClient.mockReset();
  });

  it("returns exit 2 on usage errors without dialing", async () => {
    const stderr: string[] = [];
    const code = await runCollectorMcp([], {
      stdout: () => {},
      stderr: (line) => stderr.push(line),
    });
    expect(code).toBe(2);
    expect(stderr.join("\n")).toMatch(/base-url/i);
    expect(createHttpHostTransport).not.toHaveBeenCalled();
  });

  it("returns exit 2 when baseUrl set but token source missing", async () => {
    const stderr: string[] = [];
    const code = await runCollectorMcp(
      ["--base-url", "http://127.0.0.1:9"],
      {
        stdout: () => {},
        stderr: (line) => stderr.push(line),
      },
    );
    expect(code).toBe(2);
    expect(stderr.join("\n")).toMatch(/token/i);
    expect(createHttpHostTransport).not.toHaveBeenCalled();
  });

  it("returns exit 1 with loud message on not_connected", async () => {
    createHttpHostTransport.mockRejectedValue(
      new HostWireError({
        layer: "transport",
        code: "not_connected",
        message: "WebSocket connect failed",
      }),
    );
    const stderr: string[] = [];
    const code = await runCollectorMcp(
      ["--base-url", "http://127.0.0.1:9", "--token", "t"],
      {
        stdout: () => {},
        stderr: (line) => stderr.push(line),
      },
    );
    expect(code).toBe(1);
    expect(stderr.join("\n")).toMatch(/not running|auth failed/i);
  });

  it("returns exit 1 on auth_failed", async () => {
    createHttpHostTransport.mockRejectedValue(
      new HostWireError({
        layer: "auth",
        code: "auth_failed",
        message: "unauthorized",
      }),
    );
    const stderr: string[] = [];
    const code = await runCollectorMcp(
      ["--base-url", "http://127.0.0.1:9", "--token", "bad"],
      {
        stdout: () => {},
        stderr: (line) => stderr.push(line),
      },
    );
    expect(code).toBe(1);
    expect(stderr.join("\n")).toMatch(/auth failed|not running/i);
  });

  it("returns exit 1 on token_missing", async () => {
    createHttpHostTransport.mockRejectedValue(
      new HostWireError({
        layer: "auth",
        code: "token_missing",
        message: "token required",
      }),
    );
    const stderr: string[] = [];
    const code = await runCollectorMcp(
      ["--base-url", "http://127.0.0.1:9", "--token", "t"],
      {
        stdout: () => {},
        stderr: (line) => stderr.push(line),
      },
    );
    expect(code).toBe(1);
    expect(stderr.join("\n")).toMatch(/not running|auth failed/i);
  });

  it("returns exit 1 on generic dial failure", async () => {
    createHttpHostTransport.mockRejectedValue(new Error("boom"));
    const stderr: string[] = [];
    const code = await runCollectorMcp(
      ["--base-url", "http://127.0.0.1:9", "--token", "t"],
      {
        stdout: () => {},
        stderr: (line) => stderr.push(line),
      },
    );
    expect(code).toBe(1);
    expect(stderr.join("\n")).toMatch(/Failed to reach Collector service/);
  });

  it("connects over HTTP and returns 0", async () => {
    const transport = { close: vi.fn() };
    createHttpHostTransport.mockResolvedValue(transport);
    createCollectorHostServiceClient.mockReturnValue({
      health: vi.fn(),
      close: vi.fn(),
      items: {},
    });
    const code = await runCollectorMcp(
      ["--base-url", "http://127.0.0.1:1", "--token", "secret"],
      {
        stdout: () => {},
        stderr: () => {},
      },
    );
    expect(code).toBe(0);
    expect(createHttpHostTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "http://127.0.0.1:1",
        token: "secret",
        connectTimeoutMs: 2_000,
      }),
    );
  });
});
