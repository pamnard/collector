/**
 * MCP tool registration over Collector IPC client (#174).
 * Thin adapter only — never opens SQLite.
 */

import type { CollectorIpcClient } from "@collector/client/node";
import { CONTENT_TYPES } from "@collector/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

function textResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

const contentTypeSchema = z.enum(CONTENT_TYPES);

/**
 * Build an MCP server whose tools dial the Collector service API via IPC.
 */
export function createCollectorMcpServer(
  client: CollectorIpcClient,
): McpServer {
  const server = new McpServer({
    name: "collector",
    version: "0.1.0",
  });

  server.registerTool(
    "collector_health",
    {
      description: "Ping Collector service health over local IPC",
      inputSchema: {},
    },
    async () => {
      try {
        return textResult(await client.health());
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "collector_search",
    {
      description: "Search items in the active vault",
      inputSchema: {
        query: z.string().min(1),
      },
    },
    async ({ query }) => {
      try {
        const items = await client.searchItems(query, "all");
        return textResult(
          items.map((item) => ({
            id: item.id,
            title: item.title,
            folder_path: item.folder_path,
          })),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "collector_get_item",
    {
      description: "Get an item by id (metadata + content)",
      inputSchema: {
        itemId: z.string().min(1),
      },
    },
    async ({ itemId }) => {
      try {
        return textResult(await client.getItemById(itemId));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "collector_create_item",
    {
      description: "Create an item via the Collector service",
      inputSchema: {
        title: z.string().min(1),
        content_type: contentTypeSchema.default("note"),
        description: z.string().optional(),
        url: z.string().nullable().optional(),
        content: z.string().nullable().optional(),
        folder_path: z.string().optional(),
      },
    },
    async (input) => {
      try {
        return textResult(
          await client.createItem({
            title: input.title,
            content_type: input.content_type,
            ...(input.description === undefined
              ? {}
              : { description: input.description }),
            ...(input.url === undefined ? {} : { url: input.url }),
            ...(input.content === undefined ? {} : { content: input.content }),
            ...(input.folder_path === undefined
              ? {}
              : { folder_path: input.folder_path }),
          }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "collector_update_item",
    {
      description: "Update an item via the Collector service",
      inputSchema: {
        itemId: z.string().min(1),
        title: z.string().optional(),
        description: z.string().optional(),
        url: z.string().nullable().optional(),
        content: z.string().nullable().optional(),
        folder_path: z.string().optional(),
      },
    },
    async (input) => {
      try {
        return textResult(
          await client.updateItem(input.itemId, {
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.description === undefined
              ? {}
              : { description: input.description }),
            ...(input.url === undefined ? {} : { url: input.url }),
            ...(input.content === undefined ? {} : { content: input.content }),
            ...(input.folder_path === undefined
              ? {}
              : { folder_path: input.folder_path }),
          }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "collector_delete_item",
    {
      description: "Delete an item via the Collector service",
      inputSchema: {
        itemId: z.string().min(1),
      },
    },
    async ({ itemId }) => {
      try {
        await client.deleteItem(itemId);
        return textResult({ ok: true, deleted: itemId });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "collector_create_tag",
    {
      description: "Create a tag via the Collector service",
      inputSchema: {
        name: z.string().min(1),
        color: z.string().nullable().optional(),
      },
    },
    async (input) => {
      try {
        return textResult(
          await client.createTag({
            name: input.name,
            ...(input.color === undefined ? {} : { color: input.color }),
          }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "collector_delete_tag",
    {
      description: "Delete a tag via the Collector service",
      inputSchema: {
        tagId: z.string().min(1),
      },
    },
    async ({ tagId }) => {
      try {
        await client.deleteTag(tagId);
        return textResult({ ok: true, deleted: tagId });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "collector_create_folder",
    {
      description: "Create a folder path via the Collector service",
      inputSchema: {
        folderPath: z.string().min(1),
      },
    },
    async ({ folderPath }) => {
      try {
        const path = await client.createFolder(folderPath);
        return textResult({ ok: true, path });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "collector_move_item",
    {
      description: "Move an item into a folder via the Collector service",
      inputSchema: {
        itemId: z.string().min(1),
        folderPath: z.string().min(1),
      },
    },
    async ({ itemId, folderPath }) => {
      try {
        await client.moveItemToFolderPath(itemId, folderPath);
        return textResult({ ok: true, itemId, folder_path: folderPath });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}
