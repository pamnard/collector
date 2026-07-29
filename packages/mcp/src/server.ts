/**
 * MCP tool registration over Collector IPC client (#174).
 * Thin adapter only — never opens SQLite.
 */

import type { CollectorIpcClient } from "@collector/client/node";
import { CONTENT_TYPES } from "@collector/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { z } from "zod";
import {
  requireMcpToolCatalogEntry,
  requireMcpToolParamDescription,
} from "./tools-catalog.js";

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

function paramDescribe(toolName: string, paramName: string) {
  return requireMcpToolParamDescription(toolName, paramName);
}

const contentTypeSchema = z.enum(CONTENT_TYPES);

async function resolveMediaFileInput(args: {
  filename?: string;
  dataBase64?: string;
  sourcePath?: string;
}): Promise<{ filename: string; data: Uint8Array }> {
  const hasBase64 = args.dataBase64 !== undefined && args.dataBase64 !== "";
  const hasPath = args.sourcePath !== undefined && args.sourcePath !== "";
  if (hasBase64 === hasPath) {
    throw new Error("Provide exactly one of dataBase64 or sourcePath");
  }
  if (hasPath) {
    const sourcePath = args.sourcePath!;
    const data = new Uint8Array(await readFile(sourcePath));
    const filename = args.filename?.trim() || basename(sourcePath);
    if (!filename) {
      throw new Error("filename is required when sourcePath has no basename");
    }
    return { filename, data };
  }
  const filename = args.filename?.trim();
  if (!filename) {
    throw new Error("filename is required when dataBase64 is set");
  }
  return {
    filename,
    data: Uint8Array.from(Buffer.from(args.dataBase64!, "base64")),
  };
}

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

  const health = requireMcpToolCatalogEntry("collector_health");
  server.registerTool(
    health.name,
    {
      description: health.description,
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

  const search = requireMcpToolCatalogEntry("collector_search");
  server.registerTool(
    search.name,
    {
      description: search.description,
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe(paramDescribe(search.name, "query")),
      },
    },
    async ({ query }) => {
      try {
        const items = await client.searchItems(query, "all");
        return textResult(items);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  const getItem = requireMcpToolCatalogEntry("collector_get_item");
  server.registerTool(
    getItem.name,
    {
      description: getItem.description,
      inputSchema: {
        itemId: z
          .string()
          .min(1)
          .describe(paramDescribe(getItem.name, "itemId")),
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

  const createItem = requireMcpToolCatalogEntry("collector_create_item");
  server.registerTool(
    createItem.name,
    {
      description: createItem.description,
      inputSchema: {
        title: z
          .string()
          .min(1)
          .describe(paramDescribe(createItem.name, "title")),
        content_type: contentTypeSchema
          .default("note")
          .describe(paramDescribe(createItem.name, "content_type")),
        description: z
          .string()
          .optional()
          .describe(paramDescribe(createItem.name, "description")),
        url: z
          .string()
          .nullable()
          .optional()
          .describe(paramDescribe(createItem.name, "url")),
        content: z
          .string()
          .nullable()
          .optional()
          .describe(paramDescribe(createItem.name, "content")),
        folder_path: z
          .string()
          .optional()
          .describe(paramDescribe(createItem.name, "folder_path")),
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

  const updateItem = requireMcpToolCatalogEntry("collector_update_item");
  server.registerTool(
    updateItem.name,
    {
      description: updateItem.description,
      inputSchema: {
        itemId: z
          .string()
          .min(1)
          .describe(paramDescribe(updateItem.name, "itemId")),
        title: z
          .string()
          .optional()
          .describe(paramDescribe(updateItem.name, "title")),
        description: z
          .string()
          .optional()
          .describe(paramDescribe(updateItem.name, "description")),
        url: z
          .string()
          .nullable()
          .optional()
          .describe(paramDescribe(updateItem.name, "url")),
        content: z
          .string()
          .nullable()
          .optional()
          .describe(paramDescribe(updateItem.name, "content")),
        content_type: contentTypeSchema
          .optional()
          .describe(paramDescribe(updateItem.name, "content_type")),
        tags: z
          .array(z.string().min(1))
          .optional()
          .describe(paramDescribe(updateItem.name, "tags")),
        folder_path: z
          .string()
          .optional()
          .describe(paramDescribe(updateItem.name, "folder_path")),
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
            ...(input.content_type === undefined
              ? {}
              : { content_type: input.content_type }),
            ...(input.tags === undefined ? {} : { tags: input.tags }),
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

  const getItemSource = requireMcpToolCatalogEntry("collector_get_item_source");
  server.registerTool(
    getItemSource.name,
    {
      description: getItemSource.description,
      inputSchema: {
        itemId: z
          .string()
          .min(1)
          .describe(paramDescribe(getItemSource.name, "itemId")),
      },
    },
    async ({ itemId }) => {
      try {
        return textResult(await client.getItemSource(itemId));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  const updateItemSource = requireMcpToolCatalogEntry(
    "collector_update_item_source",
  );
  server.registerTool(
    updateItemSource.name,
    {
      description: updateItemSource.description,
      inputSchema: {
        itemId: z
          .string()
          .min(1)
          .describe(paramDescribe(updateItemSource.name, "itemId")),
        rawMarkdown: z
          .string()
          .describe(paramDescribe(updateItemSource.name, "rawMarkdown")),
      },
    },
    async (input) => {
      try {
        return textResult(
          await client.updateItemSource(input.itemId, input.rawMarkdown),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  const deleteItem = requireMcpToolCatalogEntry("collector_delete_item");
  server.registerTool(
    deleteItem.name,
    {
      description: deleteItem.description,
      inputSchema: {
        itemId: z
          .string()
          .min(1)
          .describe(paramDescribe(deleteItem.name, "itemId")),
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

  const createTag = requireMcpToolCatalogEntry("collector_create_tag");
  server.registerTool(
    createTag.name,
    {
      description: createTag.description,
      inputSchema: {
        name: z
          .string()
          .min(1)
          .describe(paramDescribe(createTag.name, "name")),
        color: z
          .string()
          .nullable()
          .optional()
          .describe(paramDescribe(createTag.name, "color")),
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

  const deleteTag = requireMcpToolCatalogEntry("collector_delete_tag");
  server.registerTool(
    deleteTag.name,
    {
      description: deleteTag.description,
      inputSchema: {
        tagId: z
          .string()
          .min(1)
          .describe(paramDescribe(deleteTag.name, "tagId")),
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

  const createFolder = requireMcpToolCatalogEntry("collector_create_folder");
  server.registerTool(
    createFolder.name,
    {
      description: createFolder.description,
      inputSchema: {
        folderPath: z
          .string()
          .min(1)
          .describe(paramDescribe(createFolder.name, "folderPath")),
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

  const listFolders = requireMcpToolCatalogEntry("collector_list_folders");
  server.registerTool(
    listFolders.name,
    {
      description: listFolders.description,
      inputSchema: {},
    },
    async () => {
      try {
        const tree = await client.listFolderTree();
        return textResult(tree);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  const renameFolder = requireMcpToolCatalogEntry("collector_rename_folder");
  server.registerTool(
    renameFolder.name,
    {
      description: renameFolder.description,
      inputSchema: {
        oldPath: z
          .string()
          .min(1)
          .describe(paramDescribe(renameFolder.name, "oldPath")),
        newPath: z
          .string()
          .min(1)
          .describe(paramDescribe(renameFolder.name, "newPath")),
      },
    },
    async ({ oldPath, newPath }) => {
      try {
        const path = await client.renameFolder(oldPath, newPath);
        return textResult({ ok: true, path });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  const moveFolder = requireMcpToolCatalogEntry("collector_move_folder");
  server.registerTool(
    moveFolder.name,
    {
      description: moveFolder.description,
      inputSchema: {
        oldPath: z
          .string()
          .min(1)
          .describe(paramDescribe(moveFolder.name, "oldPath")),
        newPath: z
          .string()
          .min(1)
          .describe(paramDescribe(moveFolder.name, "newPath")),
      },
    },
    async ({ oldPath, newPath }) => {
      try {
        const path = await client.renameFolder(oldPath, newPath);
        return textResult({ ok: true, path });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  const deleteFolder = requireMcpToolCatalogEntry("collector_delete_folder");
  server.registerTool(
    deleteFolder.name,
    {
      description: deleteFolder.description,
      inputSchema: {
        folderPath: z
          .string()
          .min(1)
          .describe(paramDescribe(deleteFolder.name, "folderPath")),
      },
    },
    async ({ folderPath }) => {
      try {
        await client.deleteFolder(folderPath);
        return textResult({ ok: true, deleted: folderPath });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  const moveItem = requireMcpToolCatalogEntry("collector_move_item");
  server.registerTool(
    moveItem.name,
    {
      description: moveItem.description,
      inputSchema: {
        itemId: z
          .string()
          .min(1)
          .describe(paramDescribe(moveItem.name, "itemId")),
        folderPath: z
          .string()
          .min(1)
          .describe(paramDescribe(moveItem.name, "folderPath")),
      },
    },
    async ({ itemId, folderPath }) => {
      try {
        const moved = await client.moveItemToFolderPath(itemId, folderPath);
        return textResult({
          ok: true,
          itemId: moved.id,
          folder_path: moved.folder_path,
          item: moved,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  const listItemMedia = requireMcpToolCatalogEntry("collector_list_item_media");
  server.registerTool(
    listItemMedia.name,
    {
      description: listItemMedia.description,
      inputSchema: {
        itemId: z
          .string()
          .min(1)
          .describe(paramDescribe(listItemMedia.name, "itemId")),
      },
    },
    async ({ itemId }) => {
      try {
        return textResult(await client.listItemMedia(itemId));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  const attachMedia = requireMcpToolCatalogEntry("collector_attach_media");
  server.registerTool(
    attachMedia.name,
    {
      description: attachMedia.description,
      inputSchema: {
        itemId: z
          .string()
          .min(1)
          .describe(paramDescribe(attachMedia.name, "itemId")),
        filename: z
          .string()
          .optional()
          .describe(paramDescribe(attachMedia.name, "filename")),
        dataBase64: z
          .string()
          .optional()
          .describe(paramDescribe(attachMedia.name, "dataBase64")),
        sourcePath: z
          .string()
          .optional()
          .describe(paramDescribe(attachMedia.name, "sourcePath")),
      },
    },
    async ({ itemId, filename, dataBase64, sourcePath }) => {
      try {
        const file = await resolveMediaFileInput({
          filename,
          dataBase64,
          sourcePath,
        });
        const attached = await client.attachMediaFiles(itemId, [file]);
        return textResult(attached[0] ?? attached);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  const replaceMedia = requireMcpToolCatalogEntry("collector_replace_media");
  server.registerTool(
    replaceMedia.name,
    {
      description: replaceMedia.description,
      inputSchema: {
        itemId: z
          .string()
          .min(1)
          .describe(paramDescribe(replaceMedia.name, "itemId")),
        mediaId: z
          .string()
          .min(1)
          .describe(paramDescribe(replaceMedia.name, "mediaId")),
        filename: z
          .string()
          .optional()
          .describe(paramDescribe(replaceMedia.name, "filename")),
        dataBase64: z
          .string()
          .optional()
          .describe(paramDescribe(replaceMedia.name, "dataBase64")),
        sourcePath: z
          .string()
          .optional()
          .describe(paramDescribe(replaceMedia.name, "sourcePath")),
      },
    },
    async ({ itemId, mediaId, filename, dataBase64, sourcePath }) => {
      try {
        const file = await resolveMediaFileInput({
          filename,
          dataBase64,
          sourcePath,
        });
        return textResult(await client.replaceItemMedia(itemId, mediaId, file));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  const deleteMedia = requireMcpToolCatalogEntry("collector_delete_media");
  server.registerTool(
    deleteMedia.name,
    {
      description: deleteMedia.description,
      inputSchema: {
        itemId: z
          .string()
          .min(1)
          .describe(paramDescribe(deleteMedia.name, "itemId")),
        mediaId: z
          .string()
          .min(1)
          .describe(paramDescribe(deleteMedia.name, "mediaId")),
      },
    },
    async ({ itemId, mediaId }) => {
      try {
        await client.deleteItemMedia(itemId, mediaId);
        return textResult({ ok: true, deleted: mediaId });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  const setItemCover = requireMcpToolCatalogEntry("collector_set_item_cover");
  server.registerTool(
    setItemCover.name,
    {
      description: setItemCover.description,
      inputSchema: {
        itemId: z
          .string()
          .min(1)
          .describe(paramDescribe(setItemCover.name, "itemId")),
        mediaId: z
          .string()
          .min(1)
          .describe(paramDescribe(setItemCover.name, "mediaId")),
      },
    },
    async ({ itemId, mediaId }) => {
      try {
        return textResult(await client.setItemCoverFromMedia(itemId, mediaId));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}
