/**
 * Browser-safe MCP tool catalog for Settings → MCP (#273).
 *
 * Agent-facing name/description live here; `server.ts` registers from the same
 * strings (tool description + zod `.describe` for params). Keep a single copy.
 */

export interface CollectorMcpToolParam {
  name: string;
  required: boolean;
  typeLabel: string;
  /** Agent-facing param docs; also shown in Settings → MCP. */
  description: string;
}

export interface CollectorMcpToolCatalogEntry {
  name: string;
  description: string;
  params: CollectorMcpToolParam[];
}

const ITEM_ID_DESCRIPTION =
  "Vault-relative markdown path of the item (e.g. Inbox/note.md or AI/<uuid>.md). " +
  "Use the exact `id` returned by collector_search or collector_create_item. " +
  "Not a bare UUID — do not truncate a path to its filename stem.";

const FOLDER_PATH_DESCRIPTION =
  "Vault-relative folder path without a leading or trailing slash (e.g. Inbox or Projects/Work). " +
  "Backslashes become slashes; empty segments are dropped. " +
  "Omit or pass empty to place the item in Inbox.";

const FOLDER_PATH_CREATE_DESCRIPTION =
  "Vault-relative folder path without a leading or trailing slash (e.g. Inbox or Projects/Work). " +
  "Normalized the same way as other folder APIs (no leading/trailing slash).";

const FOLDER_PATH_MOVE_DESCRIPTION =
  "Destination vault-relative folder without a leading or trailing slash (e.g. Inbox or Projects/Work). " +
  "Empty / whitespace-only normalizes to Inbox. Creates the folder if needed.";

/** Full tool list exposed to MCP clients and Settings UI. */
export const COLLECTOR_MCP_TOOLS: readonly CollectorMcpToolCatalogEntry[] = [
  {
    name: "collector_health",
    description:
      "Ping Collector service health over local IPC. " +
      "Returns { ok, status, open, healthy }. " +
      "The vault/index is usable when ok and healthy are true (status \"healthy\"). " +
      "open indicates the service host has its index gate open; after a successful connect it is typically true.",
    params: [],
  },
  {
    name: "collector_search",
    description:
      "Full-text search over item title, description, and content in the active vault. " +
      "Does not look up by item id or path (item_id is unindexed in FTS). " +
      "Returns [{ id, title, folder_path }]; pass `id` unchanged as itemId to get/update/delete/move.",
    params: [
      {
        name: "query",
        required: true,
        typeLabel: "string",
        description:
          "FTS query over title/description/content. Not an id or path lookup — searching a UUID or path will not find the item by id.",
      },
    ],
  },
  {
    name: "collector_get_item",
    description:
      "Get one item by id (metadata + markdown content). " +
      "itemId must be the full vault-relative .md path from search/create, not a bare UUID.",
    params: [
      {
        name: "itemId",
        required: true,
        typeLabel: "string",
        description: ITEM_ID_DESCRIPTION,
      },
    ],
  },
  {
    name: "collector_create_item",
    description:
      "Create an item in the active vault. " +
      "Default content_type is note. " +
      "Omitting folder_path (or empty) creates under Inbox as {folder}/{uuid}.md. " +
      "Returns the created item; use its `id` path for later get/update/delete/move.",
    params: [
      {
        name: "title",
        required: true,
        typeLabel: "string",
        description: "Item title (non-empty).",
      },
      {
        name: "content_type",
        required: false,
        typeLabel: "enum",
        description:
          "One of: article, video, image, note, bookmark, pdf, audio, other. Defaults to note.",
      },
      {
        name: "description",
        required: false,
        typeLabel: "string",
        description: "Short description / summary. Defaults to empty string.",
      },
      {
        name: "url",
        required: false,
        typeLabel: "string | null",
        description:
          "Optional URL. Pass null or omit for no URL. On create, omitted becomes null.",
      },
      {
        name: "content",
        required: false,
        typeLabel: "string | null",
        description: "Optional markdown body. Omit or null for no content file body.",
      },
      {
        name: "folder_path",
        required: false,
        typeLabel: "string",
        description: FOLDER_PATH_DESCRIPTION,
      },
    ],
  },
  {
    name: "collector_update_item",
    description:
      "Partial update of an existing item. Only provided fields change. " +
      "itemId is the vault-relative .md path. " +
      "Passing folder_path moves the item (same path rules as create/move). " +
      "url: omit to leave unchanged; null clears the URL.",
    params: [
      {
        name: "itemId",
        required: true,
        typeLabel: "string",
        description: ITEM_ID_DESCRIPTION,
      },
      {
        name: "title",
        required: false,
        typeLabel: "string",
        description: "New title. Omit to leave unchanged.",
      },
      {
        name: "description",
        required: false,
        typeLabel: "string",
        description: "New description. Omit to leave unchanged.",
      },
      {
        name: "url",
        required: false,
        typeLabel: "string | null",
        description:
          "New URL. Omit to leave unchanged; pass null to clear.",
      },
      {
        name: "content",
        required: false,
        typeLabel: "string | null",
        description:
          "New markdown body. Omit to leave unchanged; null clears content.",
      },
      {
        name: "folder_path",
        required: false,
        typeLabel: "string",
        description:
          "Move to this folder if different from current. " + FOLDER_PATH_DESCRIPTION,
      },
    ],
  },
  {
    name: "collector_delete_item",
    description:
      "Delete an item by vault-relative .md path. itemId must be the full path from search/create, not a bare UUID.",
    params: [
      {
        name: "itemId",
        required: true,
        typeLabel: "string",
        description: ITEM_ID_DESCRIPTION,
      },
    ],
  },
  {
    name: "collector_create_tag",
    description:
      "Create a tag in the active vault. " +
      "Returns a tag object whose `id` is a UUID — use that as tagId for delete. " +
      "tagId is not a vault path and must not be confused with itemId.",
    params: [
      {
        name: "name",
        required: true,
        typeLabel: "string",
        description: "Tag display name (unique within the vault).",
      },
      {
        name: "color",
        required: false,
        typeLabel: "string | null",
        description: "Optional color string, or null. Omit for default/no color.",
      },
    ],
  },
  {
    name: "collector_delete_tag",
    description:
      "Delete a tag by its opaque UUID primary key from collector_create_tag (or other list/create flows). " +
      "Not a vault-relative path; not interchangeable with itemId.",
    params: [
      {
        name: "tagId",
        required: true,
        typeLabel: "string",
        description:
          "Opaque tag primary key (UUID) from createTag / tag list responses. Not an item path.",
      },
    ],
  },
  {
    name: "collector_create_folder",
    description:
      "Create a folder path in the active vault (no-op if it already exists after normalization). " +
      "Returns { ok, path } with the normalized path.",
    params: [
      {
        name: "folderPath",
        required: true,
        typeLabel: "string",
        description: FOLDER_PATH_CREATE_DESCRIPTION,
      },
    ],
  },
  {
    name: "collector_move_item",
    description:
      "Move an item into a folder. itemId is the vault-relative .md path; folderPath uses the same folder conventions as create. " +
      "Empty destination normalizes to Inbox. Item id changes to {folder}/{filename}.md.",
    params: [
      {
        name: "itemId",
        required: true,
        typeLabel: "string",
        description: ITEM_ID_DESCRIPTION,
      },
      {
        name: "folderPath",
        required: true,
        typeLabel: "string",
        description: FOLDER_PATH_MOVE_DESCRIPTION,
      },
    ],
  },
] as const;

const byName = new Map(
  COLLECTOR_MCP_TOOLS.map((tool) => [tool.name, tool] as const),
);

/** Look up catalog entry used when registering an MCP tool. */
export function requireMcpToolCatalogEntry(
  name: string,
): CollectorMcpToolCatalogEntry {
  const entry = byName.get(name);
  if (!entry) {
    throw new Error(`Unknown MCP tool (missing from tools-catalog): ${name}`);
  }
  return entry;
}

/** Param description from the catalog (for zod `.describe`). */
export function requireMcpToolParamDescription(
  toolName: string,
  paramName: string,
): string {
  const entry = requireMcpToolCatalogEntry(toolName);
  const param = entry.params.find((p) => p.name === paramName);
  if (!param) {
    throw new Error(
      `Unknown MCP tool param (missing from tools-catalog): ${toolName}.${paramName}`,
    );
  }
  return param.description;
}
