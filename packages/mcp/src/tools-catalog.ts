/**
 * Browser-safe MCP tool catalog for Settings → MCP.
 *
 * Agent-facing name/description live here; `server.ts` registers from the same
 * strings (tool description + zod `.describe` for params). Keep a single copy.
 * Write for agents and users — no GitHub issue numbers, no internal type/port names.
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
  "No leading or trailing slash after normalization.";

const FOLDER_PATH_MOVE_DESCRIPTION =
  "Destination vault-relative folder without a leading or trailing slash (e.g. Inbox or Projects/Work). " +
  "Empty or whitespace-only becomes Inbox. Creates the folder if needed.";

/** Full tool list exposed to MCP clients and Settings UI. */
export const COLLECTOR_MCP_TOOLS: readonly CollectorMcpToolCatalogEntry[] = [
  {
    name: "collector_health",
    description:
      "Check whether the Collector service and vault are usable. " +
      "Returns { ok, status, open, healthy }. " +
      "Proceed with vault work only when ok and healthy are true.",
    params: [],
  },
  {
    name: "collector_search",
    description:
      "Full-text search across note text (frontmatter + body) plus title and description. " +
      "Does not look up by item id or path — searching a UUID or path will not find that item by identity. " +
      "Returns { items, total, offset } for one page (default 60). " +
      "When items.length < total, more matches exist — raise offset or tell the user. " +
      "Pass each hit’s `id` unchanged as itemId to get/update/delete/move.",
    params: [
      {
        name: "query",
        required: true,
        typeLabel: "string",
        description:
          "Search text over note file contents (frontmatter + body) and title/description. " +
          "Not an id or path lookup.",
      },
    ],
  },
  {
    name: "collector_get_item",
    description:
      "Get one item by id (metadata + markdown body). " +
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
      "Create an item in the active vault. Default type is note. " +
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
        description: "Optional markdown body. Omit or null for an empty body.",
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
      "Update fields on an existing item. Only the fields you pass change. " +
      "itemId is the vault-relative .md path. " +
      "Passing folder_path moves the item (same as collector_move_item). " +
      "url: omit to leave unchanged; null clears the URL. " +
      "tags are names (as in .md frontmatter); missing names are created on this write.",
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
        name: "content_type",
        required: false,
        typeLabel: "enum",
        description:
          "New content type. One of: article, video, image, note, bookmark, pdf, audio, other. Omit to leave unchanged.",
      },
      {
        name: "tags",
        required: false,
        typeLabel: "string[]",
        description:
          "Replace item tags by name (as in vault .md frontmatter). " +
          "Missing names are created on this write — that is how tags enter the catalog. " +
          "Omit to leave unchanged; pass [] to clear all tags on the item.",
      },
      {
        name: "folder_path",
        required: false,
        typeLabel: "string",
        description:
          "Move to this folder if different from current (same as collector_move_item). " +
          FOLDER_PATH_DESCRIPTION,
      },
    ],
  },
  {
    name: "collector_get_item_source",
    description:
      "Read the raw vault .md file for an item (frontmatter + body). " +
      "Prefer collector_get_item / collector_update_item for field edits; use source for full-document round-trips.",
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
    name: "collector_update_item_source",
    description:
      "Replace the raw vault .md file for an item (frontmatter + body). " +
      "Tag names in frontmatter are applied (missing tags may be created). " +
      "itemId must be the full vault-relative path.",
    params: [
      {
        name: "itemId",
        required: true,
        typeLabel: "string",
        description: ITEM_ID_DESCRIPTION,
      },
      {
        name: "rawMarkdown",
        required: true,
        typeLabel: "string",
        description:
          "Full markdown file contents including YAML frontmatter. Replaces the on-disk document.",
      },
    ],
  },
  {
    name: "collector_wait_derived",
    description:
      "Wait until background work after a save has finished for one item revision " +
      "(search index / derived fields). Use when a later step needs that state ready. " +
      "Ordinary create/update does not require this. " +
      "Pass contentRevision from the item returned by create/update.",
    params: [
      {
        name: "itemId",
        required: true,
        typeLabel: "string",
        description: ITEM_ID_DESCRIPTION,
      },
      {
        name: "contentRevision",
        required: true,
        typeLabel: "number",
        description:
          "content_revision from the save that started the background work.",
      },
      {
        name: "timeoutMs",
        required: false,
        typeLabel: "number",
        description:
          "Optional wait limit in milliseconds (default 120000).",
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
    name: "collector_list_folders",
    description:
      "List the folder tree for the active vault " +
      "(each node: path, name, item_count, children). " +
      "Use paths from this tree for rename/move/delete folder tools.",
    params: [],
  },
  {
    name: "collector_list_folder_items",
    description:
      "List items that sit directly in one folder (exact path match; not nested child folders). " +
      "Empty folder returns []. Missing folder fails with Folder not found. " +
      "Optional sort: pass sortKey and sortDir together. " +
      "sortKey one of title, created_at, updated_at, content_type, word_count, character_count; " +
      "sortDir asc or desc. Omit both to keep default order (newest created_at first). " +
      "Returns item metadata (not full markdown bodies). Same idea as CLI list-folder-items.",
    params: [
      {
        name: "folderPath",
        required: true,
        typeLabel: "string",
        description: FOLDER_PATH_CREATE_DESCRIPTION,
      },
      {
        name: "sortKey",
        required: false,
        typeLabel: "string",
        description:
          "Sort field: title, created_at, updated_at, content_type, word_count, or character_count. " +
          "Must be paired with sortDir. Omit both for default (newest created_at first).",
      },
      {
        name: "sortDir",
        required: false,
        typeLabel: "string",
        description:
          "Sort direction: asc or desc. Must be paired with sortKey. " +
          "Omit both for default (newest created_at first).",
      },
    ],
  },
  {
    name: "collector_rename_folder",
    description:
      "Rename or move a vault folder to a new path. " +
      "Items under the old path keep working under the new path. " +
      "Returns { ok, path } with the normalized new path. " +
      "Same effect as collector_move_folder.",
    params: [
      {
        name: "oldPath",
        required: true,
        typeLabel: "string",
        description: FOLDER_PATH_CREATE_DESCRIPTION,
      },
      {
        name: "newPath",
        required: true,
        typeLabel: "string",
        description: FOLDER_PATH_CREATE_DESCRIPTION,
      },
    ],
  },
  {
    name: "collector_move_folder",
    description:
      "Move a vault folder to a new path. Same as collector_rename_folder. " +
      "Returns { ok, path } with the normalized new path.",
    params: [
      {
        name: "oldPath",
        required: true,
        typeLabel: "string",
        description: FOLDER_PATH_CREATE_DESCRIPTION,
      },
      {
        name: "newPath",
        required: true,
        typeLabel: "string",
        description: FOLDER_PATH_CREATE_DESCRIPTION,
      },
    ],
  },
  {
    name: "collector_delete_folder",
    description:
      "Recursively delete a vault folder: the folder, all nested subfolders, and every " +
      "item under that prefix (notes and media). Fails if the folder is missing or is the vault root. " +
      "Returns { ok, deleted } with the requested path.",
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
      "Move an item into a folder (same as collector_update_item with folder_path). " +
      "itemId is the vault-relative .md path. Empty destination becomes Inbox. " +
      "After the move the item id is {folder}/{filename}.md. " +
      "Returns { ok, itemId, folder_path, item } where itemId is the **new** path — use that afterward.",
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
  {
    name: "collector_list_item_media",
    description:
      "List media files attached to an item " +
      "(id, filename, media_type, created_at, absolute_path). " +
      "Use each media `id` for replace/delete/set-cover. Cover updates automatically after attach/delete/replace.",
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
    name: "collector_attach_media",
    description:
      "Attach one media file to an existing item. " +
      "Provide exactly one of dataBase64 or sourcePath. " +
      "filename is required with dataBase64; with sourcePath it defaults to the path basename. " +
      "Returns the new media record (stable media id). Cover updates from the first image/video when needed.",
    params: [
      {
        name: "itemId",
        required: true,
        typeLabel: "string",
        description: ITEM_ID_DESCRIPTION,
      },
      {
        name: "filename",
        required: false,
        typeLabel: "string",
        description:
          "Original filename including extension (used for type detection and on-disk name). " +
          "Required when dataBase64 is set; optional when sourcePath is set (defaults to basename).",
      },
      {
        name: "dataBase64",
        required: false,
        typeLabel: "string",
        description:
          "File bytes as standard base64 (no data: URL prefix). Mutually exclusive with sourcePath.",
      },
      {
        name: "sourcePath",
        required: false,
        typeLabel: "string",
        description:
          "Absolute path on the machine running Collector to read bytes from. Mutually exclusive with dataBase64.",
      },
    ],
  },
  {
    name: "collector_replace_media",
    description:
      "Replace an existing media file’s bytes (and optionally filename) while keeping the same media id. " +
      "Provide exactly one of dataBase64 or sourcePath. Cover updates afterward.",
    params: [
      {
        name: "itemId",
        required: true,
        typeLabel: "string",
        description: ITEM_ID_DESCRIPTION,
      },
      {
        name: "mediaId",
        required: true,
        typeLabel: "string",
        description:
          "Media id from collector_list_item_media / collector_attach_media (UUID). Not an item path.",
      },
      {
        name: "filename",
        required: false,
        typeLabel: "string",
        description:
          "Replacement filename including extension. Required with dataBase64; optional with sourcePath (defaults to basename).",
      },
      {
        name: "dataBase64",
        required: false,
        typeLabel: "string",
        description:
          "Replacement file bytes as standard base64. Mutually exclusive with sourcePath.",
      },
      {
        name: "sourcePath",
        required: false,
        typeLabel: "string",
        description:
          "Absolute path on the machine running Collector for replacement bytes. Mutually exclusive with dataBase64.",
      },
    ],
  },
  {
    name: "collector_delete_media",
    description:
      "Delete one media file from an item by media id. " +
      "Cover updates afterward (cleared when no image/video remains).",
    params: [
      {
        name: "itemId",
        required: true,
        typeLabel: "string",
        description: ITEM_ID_DESCRIPTION,
      },
      {
        name: "mediaId",
        required: true,
        typeLabel: "string",
        description:
          "Media id from list/attach (UUID). Not an item path.",
      },
    ],
  },
  {
    name: "collector_set_item_cover",
    description:
      "Set the item cover from a specific attached image or video. " +
      "Not required for a default cover — attach alone picks the first image/video. " +
      "Later attach/delete/replace may change the cover again automatically.",
    params: [
      {
        name: "itemId",
        required: true,
        typeLabel: "string",
        description: ITEM_ID_DESCRIPTION,
      },
      {
        name: "mediaId",
        required: true,
        typeLabel: "string",
        description:
          "Media id of an image or video attachment to use as the cover source.",
      },
    ],
  },
  {
    name: "collector_discover_extract_candidates",
    description:
      "Discover extract options for one note (from body and frontmatter URL). " +
      "Returns candidates ({ extractorId, url, optional meta }). Does not fetch or change the note. " +
      "Empty when nothing matches. " +
      "Then call collector_extract_item_candidate with a returned candidate.",
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
    name: "collector_extract_item_candidate",
    description:
      "Run extract for one candidate on an item (never runs automatically on open). " +
      "Fails when extractorId is unknown. " +
      "Prefer a candidate from collector_discover_extract_candidates.",
    params: [
      {
        name: "itemId",
        required: true,
        typeLabel: "string",
        description: ITEM_ID_DESCRIPTION,
      },
      {
        name: "extractorId",
        required: true,
        typeLabel: "string",
        description:
          "Extractor id (e.g. from discover). Unknown ids fail.",
      },
      {
        name: "url",
        required: true,
        typeLabel: "string",
        description:
          "URL to extract (from discover candidate). Non-empty string required.",
      },
      {
        name: "meta",
        required: false,
        typeLabel: "Record<string, string>",
        description:
          "Optional string map for the extractor (e.g. shortcode). Omit when unused.",
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
