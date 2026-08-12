/**
 * MCP over living domain host HTTP (#556).
 * Adapter never opens SQLite — dials startServiceHost only.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createCollectorHostServiceClient,
  createHttpHostTransport,
} from "@collector/client";
import {
  defaultServiceHostBaseUrlPath,
  defaultServiceHostTokenPath,
  startServiceHost,
} from "@collector/service/host";
import {
  McpEndpointError,
  parseMcpEndpointArgs,
  resolveMcpHostEndpoint,
} from "./endpoint.js";
import { createCollectorMcpServer } from "./server.js";
import { runCollectorMcp } from "./run.js";

describe("MCP endpoint parsing (#556)", () => {
  it("parses --base-url / --data-dir / --token", () => {
    expect(
      parseMcpEndpointArgs([
        "--base-url",
        "http://127.0.0.1:1",
        "--data-dir",
        "/data",
      ]),
    ).toEqual({
      baseUrl: "http://127.0.0.1:1",
      dataDir: "/data",
    });
  });

  it("reads argv and env for baseUrl", () => {
    const prev = process.env.COLLECTOR_SERVICE_BASE_URL;
    process.env.COLLECTOR_SERVICE_BASE_URL = "http://127.0.0.1:99";
    expect(parseMcpEndpointArgs(["--token", "t"])).toEqual({
      baseUrl: "http://127.0.0.1:99",
      token: "t",
    });
    if (prev === undefined) {
      delete process.env.COLLECTOR_SERVICE_BASE_URL;
    } else {
      process.env.COLLECTOR_SERVICE_BASE_URL = prev;
    }
  });

  it("resolve requires baseUrl or dataDir baseUrl file", async () => {
    await expect(resolveMcpHostEndpoint({ token: "t" })).rejects.toBeInstanceOf(
      McpEndpointError,
    );
  });

  it("resolve with dataDir only reads published baseUrl + token files", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-mcp-endpoint-"));
    writeFileSync(defaultServiceHostTokenPath(dataDir), "tok\n", "utf8");
    writeFileSync(
      defaultServiceHostBaseUrlPath(dataDir),
      "http://127.0.0.1:4242\n",
      "utf8",
    );
    try {
      await expect(resolveMcpHostEndpoint({ dataDir })).resolves.toEqual({
        baseUrl: "http://127.0.0.1:4242",
        token: "tok",
        dataDir,
      });
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("resolve requires token or dataDir", async () => {
    await expect(
      resolveMcpHostEndpoint({ baseUrl: "http://127.0.0.1:1" }),
    ).rejects.toThrow(/token/i);
  });
});

async function dialHttpClient(
  baseUrl: string,
  dataDir: string,
  options: { enableEvents?: boolean } = {},
) {
  const token = readFileSync(defaultServiceHostTokenPath(dataDir), "utf8").trim();
  const transport = await createHttpHostTransport({
    baseUrl,
    token,
    connectTimeoutMs: 2_000,
    enableEvents: options.enableEvents ?? false,
  });
  return createCollectorHostServiceClient(transport);
}

describe("MCP tools over host HTTP (#556)", () => {
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
    const client = await dialHttpClient(host.baseUrl, dataDir);
    const mcp = createCollectorMcpServer(client);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await Promise.all([
      mcp.connect(serverTransport),
      mcpClient.connect(clientTransport),
    ]);

    const listed = await mcpClient.listTools();
    const getItemTool = listed.tools.find((tool) => tool.name === "collector_get_item");
    expect(getItemTool?.description).toMatch(/not a bare UUID/i);
    const itemIdSchema = getItemTool?.inputSchema as {
      properties?: { itemId?: { description?: string } };
    };
    expect(itemIdSchema.properties?.itemId?.description).toMatch(
      /vault-relative/i,
    );
    expect(itemIdSchema.properties?.itemId?.description).toMatch(
      /not a bare UUID/i,
    );

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
    ) as { id: string; title: string; content_type: string; tag_ids: string[] }[];
    const hit = searchBody.find((row) => row.id === createdBody.id);
    expect(hit).toBeDefined();
    expect(hit!.title).toBe("MCP note");
    expect(hit!.content_type).toBe("note");
    expect(Array.isArray(hit!.tag_ids)).toBe(true);

    const folder = await mcpClient.callTool({
      name: "collector_create_folder",
      arguments: { folderPath: "Archive" },
    });
    expect(folder.isError).toBeFalsy();

    const moved = await mcpClient.callTool({
      name: "collector_move_item",
      arguments: { itemId: createdBody.id, folderPath: "Archive" },
    });
    expect(moved.isError).toBeFalsy();
    const movedBody = JSON.parse(
      (moved.content as { text: string }[])[0]!.text,
    ) as { ok: boolean; itemId: string; folder_path: string };
    expect(movedBody.ok).toBe(true);
    expect(movedBody.itemId).not.toBe(createdBody.id);
    expect(movedBody.itemId).toMatch(/^Archive\//);
    expect(movedBody.folder_path).toBe("Archive");

    const deleted = await mcpClient.callTool({
      name: "collector_delete_item",
      arguments: { itemId: movedBody.itemId },
    });
    expect(deleted.isError).toBeFalsy();

    await mcpClient.close();
    await mcp.close();
    await client.close();
    await host.close();
  });

  it("update content_type + tags by name and source round-trip (#351 / #348 / #354)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-mcp-351-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, host: "127.0.0.1", port: 0 });
    const client = await dialHttpClient(host.baseUrl, dataDir);
    const mcp = createCollectorMcpServer(client);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await Promise.all([
      mcp.connect(serverTransport),
      mcpClient.connect(clientTransport),
    ]);

    const created = await mcpClient.callTool({
      name: "collector_create_item",
      arguments: {
        title: "Misclassified",
        content_type: "image",
        content: "actually an article",
        url: "https://example.com/a",
      },
    });
    expect(created.isError).toBeFalsy();
    const createdBody = JSON.parse(
      (created.content as { text: string }[])[0]!.text,
    ) as { id: string; content_type: string };
    expect(createdBody.content_type).toBe("image");

    const updated = await mcpClient.callTool({
      name: "collector_update_item",
      arguments: {
        itemId: createdBody.id,
        content_type: "article",
        tags: ["brand-new-mcp-tag", "triage-351"],
      },
    });
    expect(updated.isError).toBeFalsy();
    const updatedBody = JSON.parse(
      (updated.content as { text: string }[])[0]!.text,
    ) as { content_type: string; tag_ids: string[] };
    expect(updatedBody.content_type).toBe("article");
    expect(updatedBody.tag_ids).toHaveLength(2);

    const got = await mcpClient.callTool({
      name: "collector_get_item",
      arguments: { itemId: createdBody.id },
    });
    expect(got.isError).toBeFalsy();
    const gotBody = JSON.parse(
      (got.content as { text: string }[])[0]!.text,
    ) as { item: { content_type: string; tag_ids: string[] } };
    expect(gotBody.item.content_type).toBe("article");
    expect(gotBody.item.tag_ids).toHaveLength(2);

    const source = await mcpClient.callTool({
      name: "collector_get_item_source",
      arguments: { itemId: createdBody.id },
    });
    expect(source.isError).toBeFalsy();
    const sourceText = (source.content as { text: string }[])[0]!.text;
    expect(sourceText).toMatch(/title:/);
    expect(sourceText).toMatch(/article|content_type|type:/);
    expect(sourceText).toMatch(/brand-new-mcp-tag/);
    expect(sourceText).toMatch(/triage-351/);

    const rewritten = sourceText.replace(/Misclassified/g, "Fixed title");
    const sourceUpdated = await mcpClient.callTool({
      name: "collector_update_item_source",
      arguments: { itemId: createdBody.id, rawMarkdown: rewritten },
    });
    expect(sourceUpdated.isError).toBeFalsy();
    const sourceUpdatedBody = JSON.parse(
      (sourceUpdated.content as { text: string }[])[0]!.text,
    ) as { title: string };
    expect(sourceUpdatedBody.title).toBe("Fixed title");

    await mcpClient.close();
    await mcp.close();
    await client.close();
    await host.close();
  });

  it("folder list/rename/move/delete via MCP tools (#352)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-mcp-352-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, host: "127.0.0.1", port: 0 });
    const client = await dialHttpClient(host.baseUrl, dataDir);
    const mcp = createCollectorMcpServer(client);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await Promise.all([
      mcp.connect(serverTransport),
      mcpClient.connect(clientTransport),
    ]);

    const created = await mcpClient.callTool({
      name: "collector_create_folder",
      arguments: { folderPath: "Work/Drafts" },
    });
    expect(created.isError).toBeFalsy();
    const createdBody = JSON.parse(
      (created.content as { text: string }[])[0]!.text,
    ) as { ok: boolean; path: string };
    expect(createdBody.path).toBe("Work/Drafts");

    const listed = await mcpClient.callTool({
      name: "collector_list_folders",
      arguments: {},
    });
    expect(listed.isError).toBeFalsy();
    expect(Array.isArray(
      JSON.parse((listed.content as { text: string }[])[0]!.text),
    )).toBe(true);

    const renamed = await mcpClient.callTool({
      name: "collector_rename_folder",
      arguments: { oldPath: "Work/Drafts", newPath: "Work/Ready" },
    });
    expect(renamed.isError).toBeFalsy();
    const renamedBody = JSON.parse(
      (renamed.content as { text: string }[])[0]!.text,
    ) as { path: string };
    expect(renamedBody.path).toBe("Work/Ready");

    const archive = await mcpClient.callTool({
      name: "collector_create_folder",
      arguments: { folderPath: "Archive" },
    });
    expect(archive.isError).toBeFalsy();

    const moved = await mcpClient.callTool({
      name: "collector_move_folder",
      arguments: { oldPath: "Work/Ready", newPath: "Archive/Ready" },
    });
    expect(moved.isError).toBeFalsy();
    const movedBody = JSON.parse(
      (moved.content as { text: string }[])[0]!.text,
    ) as { path: string };
    expect(movedBody.path).toBe("Archive/Ready");

    const deleted = await mcpClient.callTool({
      name: "collector_delete_folder",
      arguments: { folderPath: "Archive/Ready" },
    });
    expect(deleted.isError).toBeFalsy();
    const deletedBody = JSON.parse(
      (deleted.content as { text: string }[])[0]!.text,
    ) as { ok: boolean; deleted: string };
    expect(deletedBody).toEqual({ ok: true, deleted: "Archive/Ready" });

    await mcpClient.close();
    await mcp.close();
    await client.close();
    await host.close();
  });

  it("media attach/list/replace/delete/set-cover via MCP tools (#353)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-mcp-353-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, host: "127.0.0.1", port: 0 });
    const client = await dialHttpClient(host.baseUrl, dataDir);
    const mcp = createCollectorMcpServer(client);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await Promise.all([
      mcp.connect(serverTransport),
      mcpClient.connect(clientTransport),
    ]);

    const created = await mcpClient.callTool({
      name: "collector_create_item",
      arguments: { title: "Media MCP", content: "body" },
    });
    expect(created.isError).toBeFalsy();
    const createdBody = JSON.parse(
      (created.content as { text: string }[])[0]!.text,
    ) as { id: string };

    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    const attached = await mcpClient.callTool({
      name: "collector_attach_media",
      arguments: {
        itemId: createdBody.id,
        filename: "dot.png",
        dataBase64: pngBase64,
      },
    });
    expect(attached.isError).toBeFalsy();
    const attachedBody = JSON.parse(
      (attached.content as { text: string }[])[0]!.text,
    ) as { id: string; filename: string };
    expect(attachedBody.filename).toBe("dot.png");

    const listed = await mcpClient.callTool({
      name: "collector_list_item_media",
      arguments: { itemId: createdBody.id },
    });
    expect(listed.isError).toBeFalsy();
    const listedBody = JSON.parse(
      (listed.content as { text: string }[])[0]!.text,
    ) as Array<{ id: string }>;
    expect(listedBody.some((m) => m.id === attachedBody.id)).toBe(true);

    const replaced = await mcpClient.callTool({
      name: "collector_replace_media",
      arguments: {
        itemId: createdBody.id,
        mediaId: attachedBody.id,
        filename: "dot2.png",
        dataBase64: pngBase64,
      },
    });
    expect(replaced.isError).toBeFalsy();
    const replacedBody = JSON.parse(
      (replaced.content as { text: string }[])[0]!.text,
    ) as { id: string; filename: string };
    expect(replacedBody.id).toBe(attachedBody.id);
    expect(replacedBody.filename).toBe("dot2.png");

    const cover = await mcpClient.callTool({
      name: "collector_set_item_cover",
      arguments: { itemId: createdBody.id, mediaId: attachedBody.id },
    });
    expect(cover.isError).toBeFalsy();
    const coverBody = JSON.parse(
      (cover.content as { text: string }[])[0]!.text,
    ) as { thumbnail: string | null };
    // Cover SoT is cover.webp on disk (#276/#279); FM thumbnail stays null.
    expect(coverBody.thumbnail ?? null).toBeNull();

    const deleted = await mcpClient.callTool({
      name: "collector_delete_media",
      arguments: { itemId: createdBody.id, mediaId: attachedBody.id },
    });
    expect(deleted.isError).toBeFalsy();

    await mcpClient.close();
    await mcp.close();
    await client.close();
    await host.close();
  });

  it("runCollectorMcp fails loud when host is down (#556)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-mcp-down-"));
    dirs.push(dataDir);
    // Token file present (as if host had run) but nothing listening.
    const tokenPath = defaultServiceHostTokenPath(dataDir);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(tokenPath, "dead-token\n", { mode: 0o600 });

    const stderr: string[] = [];
    const code = await runCollectorMcp(
      [
        "--base-url",
        "http://127.0.0.1:1",
        "--data-dir",
        dataDir,
      ],
      {
        stdout: () => {},
        stderr: (line) => stderr.push(line),
      },
    );
    expect(code).toBe(1);
    expect(stderr.join("\n").length).toBeGreaterThan(0);
    expect(stderr.join("\n")).toMatch(
      /not running|auth failed|Failed to reach Collector service/i,
    );
  });

  it("production MCP sources do not open the index themselves", async () => {
    const { readFileSync: read } = await import("node:fs");
    for (const name of ["main.ts", "run.ts", "server.ts", "endpoint.ts"] as const) {
      const src = read(join(import.meta.dirname, name), "utf8");
      expect(src).not.toMatch(/createServiceDomainRuntime/);
      expect(src).not.toMatch(/startServiceHost/);
      expect(src).not.toMatch(/connectCollectorHostService/);
    }
  });
});
