/**
 * MCP tool registration over a living domain-host client (#174/#556/#826).
 * Thin adapter only — never opens SQLite.
 *
 * Catalog (`tools-catalog.ts`) owns names/descriptions; this file owns zod
 * shapes and host-client call bodies. Registration is DRY via a local
 * `tool` helper (#832).
 */

import type { CollectorHostServiceClient } from "@collector/client";
import { isHostWireError } from "@collector/service/host";
import { CONTENT_TYPES } from "@collector/shared";
import {
  McpServer,
  type ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { z, type ZodRawShape } from "zod";
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

const contentTypeSchema = z.enum(CONTENT_TYPES);

type ToolArgs<Shape extends ZodRawShape> = z.infer<z.ZodObject<Shape>>;

/** Zod field builders with catalog `.describe` text for one tool. */
function params(toolName: string) {
  const describe = (paramName: string) =>
    requireMcpToolParamDescription(toolName, paramName);
  return {
    string: (paramName: string) => z.string().describe(describe(paramName)),
    requiredString: (paramName: string) =>
      z.string().min(1).describe(describe(paramName)),
    optionalString: (paramName: string) =>
      z.string().optional().describe(describe(paramName)),
    nullableOptionalString: (paramName: string) =>
      z.string().nullable().optional().describe(describe(paramName)),
    optionalStringArray: (paramName: string) =>
      z.array(z.string().min(1)).optional().describe(describe(paramName)),
    requiredInt: (paramName: string) =>
      z.number().int().describe(describe(paramName)),
    optionalPositiveNumber: (paramName: string) =>
      z.number().positive().optional().describe(describe(paramName)),
    contentTypeDefaultNote: (paramName: string) =>
      contentTypeSchema.default("note").describe(describe(paramName)),
    contentTypeOptional: (paramName: string) =>
      contentTypeSchema.optional().describe(describe(paramName)),
    optionalStringRecord: (paramName: string) =>
      z
        .record(z.string())
        .optional()
        .describe(describe(paramName)),
  };
}

type ToolParams = ReturnType<typeof params>;

function mediaFileFields(p: ToolParams) {
  return {
    filename: p.optionalString("filename"),
    dataBase64: p.optionalString("dataBase64"),
    sourcePath: p.optionalString("sourcePath"),
  };
}

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

  /**
   * Catalog lookup + registerTool + runTool. `buildSchema` receives param
   * builders already bound to `toolName` so each tool is one compact entry.
   *
   * Cast at the SDK boundary: `registerTool` generics do not compose with a
   * Shape type parameter (InputArgs collapses to ZodRawShape).
   */
  const tool = <const Shape extends ZodRawShape>(
    toolName: string,
    buildSchema: (p: ToolParams) => Shape,
    run: (
      args: ToolArgs<Shape>,
      client: CollectorHostServiceClient,
    ) => Promise<unknown>,
  ): void => {
    const catalog = requireMcpToolCatalogEntry(toolName);
    const inputSchema = buildSchema(params(toolName));
    const handler = (async (args: ToolArgs<Shape>) =>
      runTool(session, (client) => run(args, client))) as unknown as ToolCallback<Shape>;
    server.registerTool(
      catalog.name,
      {
        description: catalog.description,
        inputSchema,
      },
      handler,
    );
  };

  tool("collector_health", () => ({}), (_args, client) => client.health());

  tool(
    "collector_search",
    (p) => ({ query: p.requiredString("query") }),
    ({ query }, client) => client.items.searchItems(query, "all"),
  );

  tool(
    "collector_get_item",
    (p) => ({ itemId: p.requiredString("itemId") }),
    ({ itemId }, client) => client.items.getItemById(itemId),
  );

  tool(
    "collector_create_item",
    (p) => ({
      title: p.requiredString("title"),
      content_type: p.contentTypeDefaultNote("content_type"),
      description: p.optionalString("description"),
      url: p.nullableOptionalString("url"),
      content: p.nullableOptionalString("content"),
      folder_path: p.optionalString("folder_path"),
    }),
    (input, client) =>
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
  );

  tool(
    "collector_update_item",
    (p) => ({
      itemId: p.requiredString("itemId"),
      title: p.optionalString("title"),
      description: p.optionalString("description"),
      url: p.nullableOptionalString("url"),
      content: p.nullableOptionalString("content"),
      content_type: p.contentTypeOptional("content_type"),
      tags: p.optionalStringArray("tags"),
      folder_path: p.optionalString("folder_path"),
    }),
    (input, client) =>
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
  );

  tool(
    "collector_get_item_source",
    (p) => ({ itemId: p.requiredString("itemId") }),
    ({ itemId }, client) => client.items.getItemSource(itemId),
  );

  tool(
    "collector_update_item_source",
    (p) => ({
      itemId: p.requiredString("itemId"),
      rawMarkdown: p.string("rawMarkdown"),
    }),
    (input, client) =>
      client.items.updateItemSource(input.itemId, input.rawMarkdown),
  );

  tool(
    "collector_wait_derived",
    (p) => ({
      itemId: p.requiredString("itemId"),
      contentRevision: p.requiredInt("contentRevision"),
      timeoutMs: p.optionalPositiveNumber("timeoutMs"),
    }),
    (input, client) =>
      client.items.waitDerived(input.itemId, input.contentRevision, {
        ...(input.timeoutMs === undefined
          ? {}
          : { timeoutMs: input.timeoutMs }),
      }),
  );

  tool(
    "collector_delete_item",
    (p) => ({ itemId: p.requiredString("itemId") }),
    async ({ itemId }, client) => {
      await client.items.deleteItem(itemId);
      return { ok: true, deleted: itemId };
    },
  );

  tool(
    "collector_create_tag",
    (p) => ({
      name: p.requiredString("name"),
      color: p.nullableOptionalString("color"),
    }),
    (input, client) =>
      client.tags.createTag({
        name: input.name,
        ...(input.color === undefined ? {} : { color: input.color }),
      }),
  );

  tool(
    "collector_delete_tag",
    (p) => ({ tagId: p.requiredString("tagId") }),
    async ({ tagId }, client) => {
      await client.tags.deleteTag(tagId);
      return { ok: true, deleted: tagId };
    },
  );

  tool(
    "collector_create_folder",
    (p) => ({ folderPath: p.requiredString("folderPath") }),
    async ({ folderPath }, client) => {
      const path = await client.folders.createFolder(folderPath);
      return { ok: true, path };
    },
  );

  tool("collector_list_folders", () => ({}), (_args, client) =>
    client.folders.listFolderTree(),
  );

  tool(
    "collector_list_folder_items",
    (p) => ({ folderPath: p.requiredString("folderPath") }),
    ({ folderPath }, client) => client.folders.listFolderItems(folderPath),
  );

  tool(
    "collector_rename_folder",
    (p) => ({
      oldPath: p.requiredString("oldPath"),
      newPath: p.requiredString("newPath"),
    }),
    async ({ oldPath, newPath }, client) => {
      const path = await client.folders.renameFolder(oldPath, newPath);
      return { ok: true, path };
    },
  );

  tool(
    "collector_move_folder",
    (p) => ({
      oldPath: p.requiredString("oldPath"),
      newPath: p.requiredString("newPath"),
    }),
    async ({ oldPath, newPath }, client) => {
      const path = await client.folders.renameFolder(oldPath, newPath);
      return { ok: true, path };
    },
  );

  tool(
    "collector_delete_folder",
    (p) => ({ folderPath: p.requiredString("folderPath") }),
    async ({ folderPath }, client) => {
      await client.folders.deleteFolder(folderPath);
      return { ok: true, deleted: folderPath };
    },
  );

  tool(
    "collector_move_item",
    (p) => ({
      itemId: p.requiredString("itemId"),
      folderPath: p.requiredString("folderPath"),
    }),
    async ({ itemId, folderPath }, client) => {
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
    },
  );

  tool(
    "collector_list_item_media",
    (p) => ({ itemId: p.requiredString("itemId") }),
    ({ itemId }, client) => client.media.listItemMedia(itemId),
  );

  tool(
    "collector_attach_media",
    (p) => ({
      itemId: p.requiredString("itemId"),
      ...mediaFileFields(p),
    }),
    async ({ itemId, filename, dataBase64, sourcePath }, client) => {
      const file = await resolveMediaFileInput({
        filename,
        dataBase64,
        sourcePath,
      });
      const attached = await client.media.attachMediaFiles(itemId, [file]);
      return attached[0] ?? attached;
    },
  );

  tool(
    "collector_replace_media",
    (p) => ({
      itemId: p.requiredString("itemId"),
      mediaId: p.requiredString("mediaId"),
      ...mediaFileFields(p),
    }),
    async ({ itemId, mediaId, filename, dataBase64, sourcePath }, client) => {
      const file = await resolveMediaFileInput({
        filename,
        dataBase64,
        sourcePath,
      });
      return client.media.replaceItemMedia(itemId, mediaId, file);
    },
  );

  tool(
    "collector_delete_media",
    (p) => ({
      itemId: p.requiredString("itemId"),
      mediaId: p.requiredString("mediaId"),
    }),
    async ({ itemId, mediaId }, client) => {
      await client.media.deleteItemMedia(itemId, mediaId);
      return { ok: true, deleted: mediaId };
    },
  );

  tool(
    "collector_set_item_cover",
    (p) => ({
      itemId: p.requiredString("itemId"),
      mediaId: p.requiredString("mediaId"),
    }),
    ({ itemId, mediaId }, client) =>
      client.media.setItemCoverFromMedia(itemId, mediaId),
  );

  tool(
    "collector_discover_extract_candidates",
    (p) => ({ itemId: p.requiredString("itemId") }),
    ({ itemId }, client) =>
      client.extract.discoverExtractCandidates(itemId),
  );

  tool(
    "collector_extract_item_candidate",
    (p) => ({
      itemId: p.requiredString("itemId"),
      extractorId: p.requiredString("extractorId"),
      url: p.requiredString("url"),
      meta: p.optionalStringRecord("meta"),
    }),
    async ({ itemId, extractorId, url, meta }, client) => {
      await client.extract.extractItemCandidate(itemId, {
        extractorId,
        url,
        ...(meta === undefined ? {} : { meta }),
      });
      return { ok: true };
    },
  );

  return server;
}
