/**
 * runCollectorMcp against a live host + real createCollectorMcpServer (#900).
 *
 * MIXED: only StdioServerTransport is substituted with an in-process
 * InMemoryTransport pair — process stdin/stdout cannot be owned under Vitest.
 * Dial, session, tool registration, and host RPC stay real.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  defaultServiceHostTokenPath,
  startServiceHost,
} from "@collector/service/host";
import { runCollectorMcp } from "./run.js";

const stdioBridge: { client: InMemoryTransport | null } = { client: null };

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", async () => {
  const { InMemoryTransport: Memory } = await import(
    "@modelcontextprotocol/sdk/inMemory.js"
  );
  return {
    StdioServerTransport: class {
      constructor() {
        const [client, server] = Memory.createLinkedPair();
        stdioBridge.client = client;
        // Returning an object from a constructor replaces `this`.
        return server;
      }
    },
  };
});

const dirs: string[] = [];

afterEach(() => {
  stdioBridge.client = null;
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDataDir(prefix: string): string {
  const dataDir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dataDir);
  return dataDir;
}

function silenceIo() {
  const stderr: string[] = [];
  return {
    stderr,
    io: {
      stdout: () => {},
      stderr: (line: string) => {
        stderr.push(line);
      },
    },
  };
}

function mcpText(result: { content: unknown }): string {
  const block = (result.content as { text?: string }[])[0];
  if (block?.text === undefined) {
    throw new Error("expected MCP text content block");
  }
  return block.text;
}

describe("runCollectorMcp (#556 / #888 / #900)", () => {
  it("returns exit 2 on usage errors without dialing", async () => {
    const { stderr, io } = silenceIo();
    const code = await runCollectorMcp([], io);
    expect(code).toBe(2);
    expect(stderr.join("\n")).toMatch(/base-url|data-dir|token/i);
    expect(stdioBridge.client).toBeNull();
  });

  it("returns exit 2 when baseUrl set but token source missing", async () => {
    const { stderr, io } = silenceIo();
    const code = await runCollectorMcp(
      ["--base-url", "http://127.0.0.1:9"],
      io,
    );
    expect(code).toBe(2);
    expect(stderr.join("\n")).toMatch(/token/i);
    expect(stdioBridge.client).toBeNull();
  });

  it("returns exit 1 when nothing is listening at base-url", async () => {
    const dataDir = tempDataDir("collector-mcp-run-down-");
    writeFileSync(defaultServiceHostTokenPath(dataDir), "dead-token\n", {
      mode: 0o600,
    });
    const { stderr, io } = silenceIo();
    const code = await runCollectorMcp(
      ["--base-url", "http://127.0.0.1:1", "--data-dir", dataDir],
      io,
    );
    expect(code).toBe(1);
    expect(stderr.join("\n")).toMatch(
      /not running|auth failed|Failed to reach Collector service/i,
    );
    expect(stdioBridge.client).toBeNull();
  });

  it("returns exit 1 on auth failure against a live host", async () => {
    const dataDir = tempDataDir("collector-mcp-run-auth-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const { stderr, io } = silenceIo();
      const code = await runCollectorMcp(
        ["--base-url", host.baseUrl, "--token", "wrong-token"],
        io,
      );
      expect(code).toBe(1);
      expect(stderr.join("\n")).toMatch(/not running|auth failed/i);
      expect(stdioBridge.client).toBeNull();
    } finally {
      await host.close();
    }
  });

  it("dials a live host, serves real MCP tools, returns 0", async () => {
    const dataDir = tempDataDir("collector-mcp-run-ok-");
    const host = await startServiceHost({ dataDir, port: 0 });
    const mcpClient = new Client({ name: "run-test", version: "0.0.1" });
    try {
      const { stderr, io } = silenceIo();
      const code = await runCollectorMcp(
        ["--base-url", host.baseUrl, "--data-dir", dataDir],
        io,
      );
      expect(code).toBe(0);
      expect(stderr).toEqual([]);

      if (stdioBridge.client === null) {
        throw new Error(
          "expected StdioServerTransport bridge client after successful run",
        );
      }
      await mcpClient.connect(stdioBridge.client);

      const listed = await mcpClient.listTools();
      const toolNames = listed.tools.map((t) => t.name);
      expect(toolNames).toEqual(
        expect.arrayContaining(["collector_health", "collector_create_item"]),
      );

      const health = await mcpClient.callTool({
        name: "collector_health",
        arguments: {},
      });
      expect(health.isError).toBeFalsy();
      expect(mcpText(health)).toMatch(/"ok"\s*:\s*true/);

      const created = await mcpClient.callTool({
        name: "collector_create_item",
        arguments: {
          title: "run.test wire",
          content_type: "note",
          content: "from real run path",
        },
      });
      expect(created.isError).toBeFalsy();
      const createdBody = JSON.parse(mcpText(created)) as {
        id: string;
        title: string;
      };
      expect(createdBody.title).toBe("run.test wire");
      expect(createdBody.id.length).toBeGreaterThan(0);
    } finally {
      await mcpClient.close();
      await host.close();
    }
  });
});
