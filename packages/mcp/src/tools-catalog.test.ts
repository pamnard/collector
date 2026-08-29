/**
 * Tool table ↔ live MCP registration contract (#873 / #273 / #265).
 * Coverage comes from COLLECTOR_MCP_TOOL_DEFS — no hand-maintained name mirror.
 * Uses in-process createCollectorMcpServer + listTools (no host / :1420).
 */

import { afterEach, describe, expect, it } from "vitest";
import type { CollectorHostServiceClient } from "@collector/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createStaticMcpHostSession } from "./host-session.js";
import {
  COLLECTOR_MCP_TOOL_DEFS,
  COLLECTOR_MCP_TOOLS,
} from "./mcp-tool-defs.js";
import { COLLECTOR_MCP_TOOL_RUNS } from "./mcp-tool-runs.js";
import { createCollectorMcpServer } from "./server.js";

type ListedTool = {
  name: string;
  description?: string;
  inputSchema: {
    properties?: Record<string, { description?: string } | undefined>;
  };
};

const openClients: Client[] = [];

afterEach(async () => {
  while (openClients.length > 0) {
    const client = openClients.pop()!;
    await client.close();
  }
});

/** Stub host — listTools never dials; registration only needs a session. */
function unusedHostClient(): CollectorHostServiceClient {
  return {
    health: async () => {
      throw new Error("unusedHostClient: health must not be called");
    },
    close: async () => undefined,
    items: {} as CollectorHostServiceClient["items"],
  } as CollectorHostServiceClient;
}

async function listRegisteredTools(): Promise<ListedTool[]> {
  const mcp = createCollectorMcpServer(
    createStaticMcpHostSession(unusedHostClient()),
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "tools-catalog-test", version: "0.0.1" });
  openClients.push(mcpClient);
  await Promise.all([
    mcp.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  const listed = await mcpClient.listTools();
  return listed.tools as ListedTool[];
}

describe("COLLECTOR_MCP_TOOL_DEFS table ↔ MCP server registration", () => {
  it("pairs every tool def with a run and registers the same set", async () => {
    const defNames = COLLECTOR_MCP_TOOL_DEFS.map((tool) => tool.name);
    const runNames = Object.keys(COLLECTOR_MCP_TOOL_RUNS);
    const registered = await listRegisteredTools();
    const registeredNames = registered.map((tool) => tool.name);

    expect(new Set(defNames).size).toBe(defNames.length);
    expect([...runNames].sort()).toEqual([...defNames].sort());
    expect([...registeredNames].sort()).toEqual([...defNames].sort());
  });

  it("derives Settings catalog from the same tool table", () => {
    expect(COLLECTOR_MCP_TOOLS.map((tool) => tool.name)).toEqual(
      COLLECTOR_MCP_TOOL_DEFS.map((tool) => tool.name),
    );
    for (let i = 0; i < COLLECTOR_MCP_TOOL_DEFS.length; i++) {
      expect(COLLECTOR_MCP_TOOLS[i]!.description).toBe(
        COLLECTOR_MCP_TOOL_DEFS[i]!.description,
      );
    }
  });

  it("registers each table tool with the table description", async () => {
    const registered = await listRegisteredTools();
    const byName = new Map(registered.map((tool) => [tool.name, tool]));

    for (const entry of COLLECTOR_MCP_TOOL_DEFS) {
      const live = byName.get(entry.name);
      expect(live, `missing registration for ${entry.name}`).toBeDefined();
      expect(live!.description).toBe(entry.description);
    }
  });

  it("registers itemId on collector_get_item as vault-relative path, not bare UUID (#265)", async () => {
    const registered = await listRegisteredTools();
    const getItem = registered.find((tool) => tool.name === "collector_get_item");
    expect(getItem).toBeDefined();
    expect(getItem!.description).toMatch(/not a bare UUID/i);
    const itemId = getItem!.inputSchema.properties?.itemId;
    expect(itemId?.description).toMatch(/vault-relative/i);
    expect(itemId?.description).toMatch(/not a bare UUID/i);
  });

  it("documents search as full-text returning paged items with total", () => {
    const search = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_search",
    );
    expect(search).toBeDefined();
    expect(search!.description).toMatch(/full-text|FTS/i);
    expect(search!.description).toMatch(/frontmatter/i);
    expect(search!.description).toMatch(/does not look up by item id/i);
    expect(search!.description).toMatch(/\bitems\b/i);
    expect(search!.description).toMatch(/total/i);
    expect(search!.description).toMatch(/more matches|truncat/i);
    const query = search!.params.find((param) => param.name === "query");
    expect(query?.description).toMatch(/not an id or path lookup/i);
    expect(query?.description).toMatch(/frontmatter/i);
  });

  it("rejects reverse-direction tag catalog tools (#842)", () => {
    const names = COLLECTOR_MCP_TOOL_DEFS.map((tool) => tool.name);
    expect(names).not.toContain("collector_create_tag");
    expect(names).not.toContain("collector_delete_tag");
  });

  it("documents tags on collector_update_item as the create path (#842)", () => {
    const update = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_update_item",
    );
    expect(update).toBeDefined();
    const tags = update!.params.find((param) => param.name === "tags");
    expect(tags).toBeDefined();
    expect(tags!.description).toMatch(/tag/i);
  });

  it("exposes full UpdateItemInput on collector_update_item (#351)", () => {
    const update = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_update_item",
    );
    expect(update).toBeDefined();
    const names = update!.params.map((param) => param.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "itemId",
        "title",
        "description",
        "url",
        "content",
        "content_type",
        "tags",
        "folder_path",
      ]),
    );
  });

  it("documents move as same as update folder_path and returns new id", () => {
    const move = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_move_item",
    );
    expect(move).toBeDefined();
    expect(move!.description).toMatch(/collector_update_item/i);
    expect(move!.description).toMatch(/new.*path|itemId is the \*\*new\*\*/i);
  });

  it("exposes folder list/rename/move/delete (#352)", () => {
    const list = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_list_folders",
    );
    expect(list).toBeDefined();
    expect(list!.params).toEqual([]);

    const listItems = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_list_folder_items",
    );
    expect(listItems).toBeDefined();
    expect(listItems!.params.map((p) => p.name)).toEqual([
      "folderPath",
      "sortKey",
      "sortDir",
    ]);
    expect(listItems!.description).toMatch(/exact path match/i);
    expect(listItems!.description).toMatch(/not nested child/i);
    expect(listItems!.description).toMatch(/sortKey/i);
    expect(listItems!.description).toMatch(/word_count/i);
    expect(listItems!.description).toMatch(/character_count/i);

    const rename = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_rename_folder",
    );
    expect(rename).toBeDefined();
    expect(rename!.params.map((p) => p.name)).toEqual(["oldPath", "newPath"]);

    const moveFolder = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_move_folder",
    );
    expect(moveFolder).toBeDefined();
    expect(moveFolder!.description).toMatch(/collector_rename_folder/i);

    const del = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_delete_folder",
    );
    expect(del).toBeDefined();
    expect(del!.description).toMatch(/recursively delete/i);
  });

  it("exposes media list/attach/replace/delete/set-cover (#353)", () => {
    const list = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_list_item_media",
    );
    expect(list).toBeDefined();
    expect(list!.params.map((p) => p.name)).toEqual(["itemId"]);

    const attach = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_attach_media",
    );
    expect(attach).toBeDefined();
    expect(attach!.params.map((p) => p.name)).toEqual(
      expect.arrayContaining(["itemId", "filename", "dataBase64", "sourcePath"]),
    );
    expect(attach!.description).toMatch(/exactly one of dataBase64 or sourcePath/i);

    const replace = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_replace_media",
    );
    expect(replace).toBeDefined();
    expect(replace!.params.map((p) => p.name)).toEqual(
      expect.arrayContaining(["itemId", "mediaId", "dataBase64", "sourcePath"]),
    );

    const del = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_delete_media",
    );
    expect(del).toBeDefined();

    const cover = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_set_item_cover",
    );
    expect(cover).toBeDefined();
    expect(cover!.description).toMatch(/not required for a default cover/i);
  });
});
