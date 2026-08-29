/**
 * Host-client handlers for MCP tools (Node). Paired 1:1 with
 * `COLLECTOR_MCP_TOOL_DEFS` via `satisfies` — no third name list.
 */

import type { CollectorHostServiceClient } from "@collector/client";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { COLLECTOR_MCP_TOOL_DEFS } from "./mcp-tool-defs.js";

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

type ToolName = (typeof COLLECTOR_MCP_TOOL_DEFS)[number]["name"];

type McpToolRun = (
  args: Record<string, unknown>,
  client: CollectorHostServiceClient,
) => Promise<unknown>;

/**
 * One run per tool-table name. Typecheck fails if a def is missing a run
 * or a run references an unknown tool.
 */
export const COLLECTOR_MCP_TOOL_RUNS = {
  collector_health: (_args, client) => client.health(),

  collector_search: (args, client) =>
    client.items.searchItems(args.query as string, "all"),

  collector_get_item: (args, client) =>
    client.items.getItemById(args.itemId as string),

  collector_create_item: (args, client) =>
    client.items.createItem({
      title: args.title as string,
      content_type: args.content_type as never,
      ...(args.description === undefined
        ? {}
        : { description: args.description as string }),
      ...(args.url === undefined ? {} : { url: args.url as string | null }),
      ...(args.content === undefined
        ? {}
        : { content: args.content as string | null }),
      ...(args.folder_path === undefined
        ? {}
        : { folder_path: args.folder_path as string }),
    }),

  collector_update_item: (args, client) =>
    client.items.updateItem(args.itemId as string, {
      ...(args.title === undefined ? {} : { title: args.title as string }),
      ...(args.description === undefined
        ? {}
        : { description: args.description as string }),
      ...(args.url === undefined ? {} : { url: args.url as string | null }),
      ...(args.content === undefined
        ? {}
        : { content: args.content as string | null }),
      ...(args.content_type === undefined
        ? {}
        : { content_type: args.content_type as never }),
      ...(args.tags === undefined ? {} : { tags: args.tags as string[] }),
      ...(args.folder_path === undefined
        ? {}
        : { folder_path: args.folder_path as string }),
    }),

  collector_get_item_source: (args, client) =>
    client.items.getItemSource(args.itemId as string),

  collector_update_item_source: (args, client) =>
    client.items.updateItemSource(
      args.itemId as string,
      args.rawMarkdown as string,
    ),

  collector_wait_derived: (args, client) =>
    client.items.waitDerived(
      args.itemId as string,
      args.contentRevision as number,
      {
        ...(args.timeoutMs === undefined
          ? {}
          : { timeoutMs: args.timeoutMs as number }),
      },
    ),

  collector_delete_item: async (args, client) => {
    const itemId = args.itemId as string;
    await client.items.deleteItem(itemId);
    return { ok: true, deleted: itemId };
  },

  collector_create_folder: async (args, client) => {
    const path = await client.folders.createFolder(args.folderPath as string);
    return { ok: true, path };
  },

  collector_list_folders: (_args, client) => client.folders.listFolderTree(),

  collector_list_folder_items: async (args, client) => {
    const folderPath = args.folderPath as string;
    const sortKey = args.sortKey as string | undefined;
    const sortDir = args.sortDir as string | undefined;
    if (sortKey === undefined && sortDir === undefined) {
      return client.folders.listFolderItems(folderPath);
    }
    if (sortKey === undefined || sortDir === undefined) {
      throw new Error(
        "collector_list_folder_items: sortKey and sortDir must be used together",
      );
    }
    if (sortDir !== "asc" && sortDir !== "desc") {
      throw new Error(
        "collector_list_folder_items: sortDir must be asc or desc",
      );
    }
    return client.folders.listFolderItems(folderPath, {
      key: sortKey,
      dir: sortDir,
    });
  },

  collector_rename_folder: async (args, client) => {
    const path = await client.folders.renameFolder(
      args.oldPath as string,
      args.newPath as string,
    );
    return { ok: true, path };
  },

  collector_move_folder: async (args, client) => {
    const path = await client.folders.renameFolder(
      args.oldPath as string,
      args.newPath as string,
    );
    return { ok: true, path };
  },

  collector_delete_folder: async (args, client) => {
    const folderPath = args.folderPath as string;
    await client.folders.deleteFolder(folderPath);
    return { ok: true, deleted: folderPath };
  },

  collector_move_item: async (args, client) => {
    const moved = await client.folders.moveItemToFolderPath(
      args.itemId as string,
      args.folderPath as string,
    );
    return {
      ok: true,
      itemId: moved.id,
      folder_path: moved.folder_path,
      item: moved,
    };
  },

  collector_list_item_media: (args, client) =>
    client.media.listItemMedia(args.itemId as string),

  collector_attach_media: async (args, client) => {
    const file = await resolveMediaFileInput({
      filename: args.filename as string | undefined,
      dataBase64: args.dataBase64 as string | undefined,
      sourcePath: args.sourcePath as string | undefined,
    });
    const attached = await client.media.attachMediaFiles(
      args.itemId as string,
      [file],
    );
    return attached[0] ?? attached;
  },

  collector_replace_media: async (args, client) => {
    const file = await resolveMediaFileInput({
      filename: args.filename as string | undefined,
      dataBase64: args.dataBase64 as string | undefined,
      sourcePath: args.sourcePath as string | undefined,
    });
    return client.media.replaceItemMedia(
      args.itemId as string,
      args.mediaId as string,
      file,
    );
  },

  collector_delete_media: async (args, client) => {
    const mediaId = args.mediaId as string;
    await client.media.deleteItemMedia(args.itemId as string, mediaId);
    return { ok: true, deleted: mediaId };
  },

  collector_set_item_cover: (args, client) =>
    client.media.setItemCoverFromMedia(
      args.itemId as string,
      args.mediaId as string,
    ),

  collector_discover_extract_candidates: (args, client) =>
    client.extract.discoverExtractCandidates(args.itemId as string),

  collector_extract_item_candidate: async (args, client) => {
    const meta = args.meta as Record<string, string> | undefined;
    await client.extract.extractItemCandidate(args.itemId as string, {
      extractorId: args.extractorId as string,
      url: args.url as string,
      ...(meta === undefined ? {} : { meta }),
    });
    return { ok: true };
  },
} as const satisfies Record<ToolName, McpToolRun>;

export type { ToolName, McpToolRun };
