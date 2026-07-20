import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { connectCollectorIpcClient } from "@collector/client/node";
import { startServiceHost } from "@collector/service/host";
import {
  McpEndpointError,
  parseMcpEndpointArgs,
  resolveMcpIpcPath,
} from "./endpoint.js";
import { createCollectorMcpServer } from "./server.js";

describe("MCP endpoint parsing (#174)", () => {
  it("resolves --data-dir / --ipc-path", () => {
    expect(resolveMcpIpcPath({ dataDir: "/data" })).toMatch(
      /collector-service\.sock$/,
    );
    expect(resolveMcpIpcPath({ ipcPath: "/tmp/x.sock" })).toBe("/tmp/x.sock");
    expect(() =>
      resolveMcpIpcPath({ dataDir: "/d", ipcPath: "/s" }),
    ).toThrow(McpEndpointError);
  });

  it("reads argv and env", () => {
    expect(parseMcpEndpointArgs(["--data-dir", "/data"])).toEqual({
      dataDir: "/data",
    });
    const prev = process.env.COLLECTOR_IPC_PATH;
    process.env.COLLECTOR_IPC_PATH = "/env.sock";
    expect(parseMcpEndpointArgs([])).toEqual({ ipcPath: "/env.sock" });
    if (prev === undefined) {
      delete process.env.COLLECTOR_IPC_PATH;
    } else {
      process.env.COLLECTOR_IPC_PATH = prev;
    }
  });
});

describe("MCP tools over service IPC (#174)", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    while (dirs.length > 0) {
      const dir = dirs.pop()!;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("health + create/search/delete via MCP tools (no SQLite in adapter)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-mcp-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, host: "127.0.0.1", port: 0 });
    const ipc = connectCollectorIpcClient(resolveMcpIpcPath({ dataDir }), {
      connectTimeoutMs: 2_000,
    });
    const client = await ipc;
    const mcp = createCollectorMcpServer(client);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await Promise.all([
      mcp.connect(serverTransport),
      mcpClient.connect(clientTransport),
    ]);

    const health = await mcpClient.callTool({ name: "collector_health", arguments: {} });
    expect(health.isError).toBeFalsy();
    const healthText = (health.content as { type: string; text: string }[])[0]?.text ?? "";
    expect(healthText).toMatch(/"ok"\s*:\s*true/);

    const created = await mcpClient.callTool({
      name: "collector_create_item",
      arguments: {
        title: "MCP note",
        content_type: "note",
        content: "from mcp",
      },
    });
    expect(created.isError).toBeFalsy();
    const createdBody = JSON.parse(
      (created.content as { text: string }[])[0]!.text,
    ) as { id: string; title: string };
    expect(createdBody.title).toBe("MCP note");

    const search = await mcpClient.callTool({
      name: "collector_search",
      arguments: { query: "MCP" },
    });
    expect(search.isError).toBeFalsy();
    const searchBody = JSON.parse(
      (search.content as { text: string }[])[0]!.text,
    ) as { id: string }[];
    expect(searchBody.some((row) => row.id === createdBody.id)).toBe(true);

    const deleted = await mcpClient.callTool({
      name: "collector_delete_item",
      arguments: { itemId: createdBody.id },
    });
    expect(deleted.isError).toBeFalsy();

    await mcpClient.close();
    await mcp.close();
    await client.close();
    await host.close();
  });
});
