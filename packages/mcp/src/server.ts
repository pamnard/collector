/**
 * MCP tool registration over a living domain-host client (#174/#556/#826).
 * Thin adapter only — never opens SQLite.
 */

import type { CollectorHostServiceClient } from "@collector/client";
import { isHostWireError } from "@collector/service/host";
import { CONTENT_TYPES } from "@collector/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { z } from "zod";
import {
  formatMcpAuthFailure,
  type McpHostSession,
} from "./host-session.js";
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

function errorResult(error: unknown, session: McpHostSession) {
  const message =
    isHostWireError(error) && error.code === "auth_failed"
      ? formatMcpAuthFailure(error, session)
      : error instanceof Error
        ? error.message
        : String(error);
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

async function runTool(
  session: McpHostSession,
  fn: (client: CollectorHostServiceClient) => Promise<unknown>,
) {
  try {
    return textResult(await session.withAuthRetry(fn));
  } catch (error) {
    return errorResult(error, session);
  }
}

function paramDescribe(toolName: string, paramName: string) {
  return requireMcpToolParamDescription(toolName, paramName);
}

const contentTypeSchema = z.enum(CONTENT_TYPES);

async function resolveMediaFileInput(args: {
  filename?: string;
  dataBase64?: string;
  sourcePath?: string;
}): Promise<{ name: string; bytes: Uint8Array }> {
  const hasBase64 = args.dataBase64 !== undefined && args.dataBase64 !== "";
  const hasPath = args.sourcePath !== undefined && args.sourcePath !== "";
  if (hasBase64 === hasPath) {
    throw new Error("Provide exactly one of dataBase64 or sourcePath");
  }
  if (hasPath) {
    const sourcePath = args.sourcePath!;
    const bytes = new Uint8Array(await readFile(sourcePath));
    const name = args.filename?.trim() || basename(sourcePath);
    if (!name) {
      throw new Error("filename is required when sourcePath has no basename");
    }
    return { name, bytes };
  }
  const name = args.filename?.trim();
  if (!name) {
    throw new Error("filename is required when dataBase64 is set");
  }
  return {
    name,
    bytes: Uint8Array.from(Buffer.from(args.dataBase64!, "base64")),
  };
}

/**
 * Build an MCP server whose tools call the living domain host (HTTP client).
 * Session may refresh data-dir credentials once on auth_failed (#826).
 */
export function createCollectorMcpServer(session: McpHostSession): McpServer {
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
    async () => runTool(session, (client) => client.health()),
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
    async ({ query }) =>
      runTool(session, (client) => client.items.searchItems(query, "all")),
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
    async ({ itemId }) =>
      runTool(session, (client) => client.items.getItemById(itemId)),
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
    async (input) =>
      runTool(session, (client) =>
        client.items.createItem({
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
      ),
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
    async (input) =>
      runTool(session, (client) =>
        client.items.updateItem(input.itemId, {
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
      ),
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
    async ({ itemId }) =>
      runTool(session, (client) => client.items.getItemSource(itemId)),
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
    async (input) =>
      runTool(session, (client) =>
        client.items.updateItemSource(input.itemId, input.rawMarkdown),
      ),
  );

  const waitDerived = requireMcpToolCatalogEntry("collector_wait_derived");
  server.registerTool(
    waitDerived.name,
    {
      description: waitDerived.description,
      inputSchema: {
        itemId: z
          .string()
          .min(1)
          .describe(paramDescribe(waitDerived.name, "itemId")),
        contentRevision: z
          .number()
          .int()
          .describe(paramDescribe(waitDerived.name, "contentRevision")),
        timeoutMs: z
          .number()
          .positive()
          .optional()
          .describe(paramDescribe(waitDerived.name, "timeoutMs")),
      },
    },
    async (input) =>
      runTool(session, (client) =>
        client.items.waitDerived(input.itemId, input.contentRevision, {
          ...(input.timeoutMs === undefined
            ? {}
            : { timeoutMs: input.timeoutMs }),
        }),
      ),
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
    async ({ itemId }) =>
      runTool(session, async (client) => {
        await client.items.deleteItem(itemId);
        return { ok: true, deleted: itemId };
      }),
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
    async (input) =>
      runTool(session, (client) =>
        client.tags.createTag({
          name: input.name,
          ...(input.color === undefined ? {} : { color: input.color }),
        }),
      ),
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
    async ({ tagId }) =>
      runTool(session, async (client) => {
        await client.tags.deleteTag(tagId);
        return { ok: true, deleted: tagId };
      }),
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
    async ({ folderPath }) =>
      runTool(session, async (client) => {
        const path = await client.folders.createFolder(folderPath);
        return { ok: true, path };
      }),
  );

  const listFolders = requireMcpToolCatalogEntry("collector_list_folders");
  server.registerTool(
    listFolders.name,
    {
      description: listFolders.description,
      inputSchema: {},
    },
    async () =>
      runTool(session, (client) => client.folders.listFolderTree()),
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
    async ({ oldPath, newPath }) =>
      runTool(session, async (client) => {
        const path = await client.folders.renameFolder(oldPath, newPath);
        return { ok: true, path };
      }),
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
    async ({ oldPath, newPath }) =>
      runTool(session, async (client) => {
        const path = await client.folders.renameFolder(oldPath, newPath);
        return { ok: true, path };
      }),
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
    async ({ folderPath }) =>
      runTool(session, async (client) => {
        await client.folders.deleteFolder(folderPath);
        return { ok: true, deleted: folderPath };
      }),
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
    async ({ itemId, folderPath }) =>
      runTool(session, async (client) => {
        const moved = await client.folders.moveItemToFolderPath(
          itemId,
          folderPath,
        );
        return {
          ok: true,
          itemId: moved.id,
          folder_path: moved.folder_path,
          item: moved,
        };
      }),
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
    async ({ itemId }) =>
      runTool(session, (client) => client.media.listItemMedia(itemId)),
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
    async ({ itemId, filename, dataBase64, sourcePath }) =>
      runTool(session, async (client) => {
        const file = await resolveMediaFileInput({
          filename,
          dataBase64,
          sourcePath,
        });
        const attached = await client.media.attachMediaFiles(itemId, [file]);
        return attached[0] ?? attached;
      }),
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
    async ({ itemId, mediaId, filename, dataBase64, sourcePath }) =>
      runTool(session, async (client) => {
        const file = await resolveMediaFileInput({
          filename,
          dataBase64,
          sourcePath,
        });
        return client.media.replaceItemMedia(itemId, mediaId, file);
      }),
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
    async ({ itemId, mediaId }) =>
      runTool(session, async (client) => {
        await client.media.deleteItemMedia(itemId, mediaId);
        return { ok: true, deleted: mediaId };
      }),
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
    async ({ itemId, mediaId }) =>
      runTool(session, (client) =>
        client.media.setItemCoverFromMedia(itemId, mediaId),
      ),
  );

  return server;
}
