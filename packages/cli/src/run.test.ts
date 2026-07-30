import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceIpcError } from "@collector/service/host";

const connectCollectorIpcService = vi.fn();

vi.mock("@collector/client/node", () => ({
  connectCollectorIpcService: (...args: unknown[]) =>
    connectCollectorIpcService(...args),
}));

import { runCollectorCli } from "./run.js";

describe("runCollectorCli unit smoke", () => {
  beforeEach(() => {
    connectCollectorIpcService.mockReset();
  });

  it("returns exit 2 on usage errors without dialing IPC", async () => {
    const stderr: string[] = [];
    const code = await runCollectorCli(["health"], {
      stdout: () => {},
      stderr: (line) => stderr.push(line),
    });
    expect(code).toBe(2);
    expect(stderr.join("\n").length).toBeGreaterThan(0);
    expect(connectCollectorIpcService).not.toHaveBeenCalled();
  });

  it("returns exit 1 with service-not-running message on not_connected", async () => {
    connectCollectorIpcService.mockRejectedValue(
      new ServiceIpcError({
        layer: "transport",
        code: "not_connected",
        message: "IPC connect failed: ENOENT",
      }),
    );
    const stderr: string[] = [];
    const code = await runCollectorCli(
      ["--ipc-path", "/tmp/collector-missing.sock", "health"],
      {
        stdout: () => {},
        stderr: (line) => stderr.push(line),
      },
    );
    expect(code).toBe(1);
    expect(stderr.join("\n")).toMatch(/not running/i);
  });

  it("returns exit 1 on generic connect failure", async () => {
    connectCollectorIpcService.mockRejectedValue(new Error("boom"));
    const stderr: string[] = [];
    const code = await runCollectorCli(
      ["--ipc-path", "/tmp/collector-x.sock", "health"],
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
    connectCollectorIpcService.mockResolvedValue({
      health,
      close,
      items: {},
    });
    const stdout: string[] = [];
    const code = await runCollectorCli(
      ["--data-dir", "/tmp/collector-data", "health"],
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
    connectCollectorIpcService.mockResolvedValue({
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
});
