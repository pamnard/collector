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

vi.mock("./parse-args/endpoint.js", () => ({
  resolveCliHostEndpoint: async (args: {
    baseUrl: string;
    dataDir?: string;
    token?: string;
  }) => {
    if (args.token !== undefined && args.token.trim() !== "") {
      return {
        baseUrl: args.baseUrl,
        token: args.token.trim(),
        ...(args.dataDir === undefined ? {} : { dataDir: args.dataDir }),
      };
    }
    if (args.dataDir === undefined) {
      throw new Error("token required");
    }
    return {
      baseUrl: args.baseUrl,
      token: "test-token",
      dataDir: args.dataDir,
    };
  },
}));

import { runCollectorCli } from "./run.js";

const BASE = ["--base-url", "http://127.0.0.1:9"] as const;

describe("runCollectorCli unit smoke", () => {
  beforeEach(() => {
    createHttpHostTransport.mockReset();
    createCollectorHostServiceClient.mockReset();
  });

  it("returns exit 2 on usage errors without dialing host", async () => {
    const stderr: string[] = [];
    const code = await runCollectorCli(["health"], {
      stdout: () => {},
      stderr: (line) => stderr.push(line),
    });
    expect(code).toBe(2);
    expect(stderr.join("\n").length).toBeGreaterThan(0);
    expect(createHttpHostTransport).not.toHaveBeenCalled();
  });

  it("returns exit 1 with service-not-running message on not_connected", async () => {
    createHttpHostTransport.mockRejectedValue(
      new HostWireError({
        layer: "transport",
        code: "not_connected",
        message: "WebSocket connect failed: ws://127.0.0.1:9/api/events",
      }),
    );
    const stderr: string[] = [];
    const code = await runCollectorCli(
      [...BASE, "--token", "secret", "health"],
      {
        stdout: () => {},
        stderr: (line) => stderr.push(line),
      },
    );
    expect(code).toBe(1);
    expect(stderr.join("\n")).toMatch(/not running/i);
  });

  it("returns exit 1 on generic connect failure", async () => {
    createHttpHostTransport.mockRejectedValue(new Error("boom"));
    const stderr: string[] = [];
    const code = await runCollectorCli(
      [...BASE, "--token", "secret", "health"],
      {
        stdout: () => {},
        stderr: (line) => stderr.push(line),
      },
    );
    expect(code).toBe(1);
    expect(stderr.join("\n")).toMatch(/Failed to reach Collector service/);
  });

  it("health succeeds and closes the client", async () => {
    const close = vi.fn(async () => undefined);
    const health = vi.fn(async () => ({ ok: true, status: "healthy" }));
    createHttpHostTransport.mockResolvedValue({});
    createCollectorHostServiceClient.mockReturnValue({
      health,
      close,
      items: {},
    });
    const stdout: string[] = [];
    const code = await runCollectorCli(
      [...BASE, "--data-dir", "/tmp/collector-data", "health"],
      {
        stdout: (line) => stdout.push(line),
        stderr: () => {},
      },
    );
    expect(code).toBe(0);
    expect(JSON.parse(stdout.join("\n"))).toEqual({
      ok: true,
      status: "healthy",
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("create-item forwards fields then closes", async () => {
    const close = vi.fn(async () => undefined);
    const createItem = vi.fn(async (input: unknown) => ({
      id: "Inbox/note.md",
      ...(input as object),
    }));
    createHttpHostTransport.mockResolvedValue({});
    createCollectorHostServiceClient.mockReturnValue({
      health: vi.fn(),
      close,
      items: { createItem },
      tags: {},
      folders: {},
      media: {},
    });
    const stdout: string[] = [];
    const code = await runCollectorCli(
      [
        ...BASE,
        "--data-dir",
        "/tmp/collector-data",
        "create-item",
        "--title",
        "CLI note",
        "--type",
        "note",
        "--content",
        "hello",
      ],
      {
        stdout: (line) => stdout.push(line),
        stderr: () => {},
      },
    );
    expect(code).toBe(0);
    expect(createItem).toHaveBeenCalledWith({
      title: "CLI note",
      content_type: "note",
      content: "hello",
    });
    expect(JSON.parse(stdout.join("\n")).title).toBe("CLI note");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("import-folder --wait exits 1 when result.failed > 0", async () => {
    const close = vi.fn(async () => undefined);
    const importFolder = vi.fn(async () => ({ jobId: "job-1" }));
    const getImportFolderJob = vi.fn(async () => ({
      jobId: "job-1",
      status: "succeeded",
      result: {
        createdIds: [],
        skippedIds: [],
        failures: [{ relativePath: "a.md", error: "boom" }],
        created: 0,
        skipped: 0,
        failed: 1,
        status: "failed",
      },
      error: null,
    }));
    createHttpHostTransport.mockResolvedValue({});
    createCollectorHostServiceClient.mockReturnValue({
      health: vi.fn(),
      close,
      items: { importFolder, getImportFolderJob },
      tags: {},
      folders: {},
      media: {},
    });
    const stdout: string[] = [];
    const code = await runCollectorCli(
      [
        ...BASE,
        "--data-dir",
        "/tmp/collector-data",
        "import-folder",
        "--path",
        "/abs/notes",
        "--wait",
      ],
      {
        stdout: (line) => stdout.push(line),
        stderr: () => {},
      },
    );
    expect(code).toBe(1);
    expect(JSON.parse(stdout.join("\n")).result.failed).toBe(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
