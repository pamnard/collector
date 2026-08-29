/**
 * runCollectorMcp bootstrap against a real service host (#556 / #888).
 * Usage errors stay local; dial paths hit live HTTP (stdio MCP transport only mocked).
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultServiceHostTokenPath,
  startServiceHost,
} from "@collector/service/host";
import { runCollectorMcp } from "./run.js";

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {
    constructor() {}
  },
}));

vi.mock("./server.js", () => ({
  createCollectorMcpServer: () => ({
    connect: vi.fn(async () => undefined),
  }),
}));

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDataDir(prefix: string): string {
  const dataDir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dataDir);
  return dataDir;
}

describe("runCollectorMcp (#556 / #888)", () => {
  it("returns exit 2 on usage errors without dialing", async () => {
    const stderr: string[] = [];
    const code = await runCollectorMcp([], {
      stdout: () => {},
      stderr: (line) => stderr.push(line),
    });
    expect(code).toBe(2);
    expect(stderr.join("\n")).toMatch(/base-url|data-dir|token/i);
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
  });

  it("returns exit 1 when nothing is listening at base-url", async () => {
    const dataDir = tempDataDir("collector-mcp-run-down-");
    writeFileSync(defaultServiceHostTokenPath(dataDir), "dead-token\n", {
      mode: 0o600,
    });
    const stderr: string[] = [];
    const code = await runCollectorMcp(
      ["--base-url", "http://127.0.0.1:1", "--data-dir", dataDir],
      {
        stdout: () => {},
        stderr: (line) => stderr.push(line),
      },
    );
    expect(code).toBe(1);
    expect(stderr.join("\n")).toMatch(
      /not running|auth failed|Failed to reach Collector service/i,
    );
  });

  it("returns exit 1 on auth failure against a live host", async () => {
    const dataDir = tempDataDir("collector-mcp-run-auth-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const stderr: string[] = [];
      const code = await runCollectorMcp(
        ["--base-url", host.baseUrl, "--token", "wrong-token"],
        {
          stdout: () => {},
          stderr: (line) => stderr.push(line),
        },
      );
      expect(code).toBe(1);
      expect(stderr.join("\n")).toMatch(/not running|auth failed/i);
    } finally {
      await host.close();
    }
  });

  it("dials a live host and returns 0", async () => {
    const dataDir = tempDataDir("collector-mcp-run-ok-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const stderr: string[] = [];
      const code = await runCollectorMcp(
        ["--base-url", host.baseUrl, "--data-dir", dataDir],
        {
          stdout: () => {},
          stderr: (line) => stderr.push(line),
        },
      );
      expect(code).toBe(0);
      expect(stderr).toEqual([]);
    } finally {
      await host.close();
    }
  });
});
