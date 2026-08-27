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
      "Ping Collector service health over HTTP. " +
      "Returns { ok, status, open, healthy }. " +
      "The vault/index is usable when ok and healthy are true (status \"healthy\"). " +
      "open indicates the service host has its index gate open; after a successful connect it is typically true.",
    params: [],
  },
  {
    name: "collector_search",
    description:
      "Full-text search over the full on-disk note markdown (YAML/TOML/JSON frontmatter + body), " +
      "plus title and description columns, in the active vault. " +
      "Does not look up by item id or path (item_id is unindexed in FTS). " +
      "Returns { items: ItemFile[], total, offset } capped to one page (default 60). " +
      "When items.length < total the result is truncated — page with a later offset or tell the user more matches exist. " +
      "Pass each item `id` unchanged as itemId to get/update/delete/move.",
    params: [
      {
        name: "query",
        required: true,
        typeLabel: "string",
        description:
          "FTS query over the full note file text (frontmatter + body) and title/description. " +
          "Not an id or path lookup — searching a UUID or path will not find the item by id.",
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
      "Partial update of an existing item (full UpdateItemInput surface). Only provided fields change. " +
      "itemId is the vault-relative .md path. " +
      "Passing folder_path moves the item (same host path as collector_move_item). " +
      "url: omit to leave unchanged; null clears the URL. " +
      "content_type and tags (tag names, same as .md frontmatter) are supported (same as the UI form). " +
      "Missing tag names are created, same as collector_update_item_source.",
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
          "Missing names are created on this document write — that is the only supported way tags enter the catalog (#842). " +
          "Omit to leave unchanged; pass [] to clear all tags on the item.",
      },
      {
        name: "folder_path",
        required: false,
        typeLabel: "string",
        description:
          "Move to this folder if different from current (alias of collector_move_item). " +
          FOLDER_PATH_DESCRIPTION,
      },
    ],
  },
  {
    name: "collector_get_item_source",
    description:
      "Read the raw vault .md document for an item (frontmatter + body), same as the UI source editor. " +
      "itemId must be the full vault-relative path. Prefer structured get/update for field edits; use source for full-document round-trips.",
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
      "Replace the raw vault .md document for an item (frontmatter + body), same as the UI source save. " +
      "Re-parses into the item model; tag names in frontmatter are resolved (missing tags may be created). " +
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
      "Opt-in await of post-save derived work (itemDerivedRefresh) for one item revision (#770). " +
      "For scripts/agents that must chain on indexed/localized state. " +
      "Do not use for ordinary UI save or bulk update loops — default mutate is fire-and-forget. " +
      "Pass contentRevision from the ItemFile returned by create/update.",
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
          "Item content_revision from the save that enqueued derived work.",
      },
      {
        name: "timeoutMs",
        required: false,
        typeLabel: "number",
        description:
          "Optional wait ceiling in milliseconds (default host job-wait: 120000).",
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
      "List the folder tree for the active vault (FolderTreeNode[]: path, name, item_count, children). " +
      "Same listFolderTree service surface as the UI client. " +
      "Use paths from this tree for rename/move/delete folder tools.",
    params: [],
  },
  {
    name: "collector_list_folder_items",
    description:
      "List items in one folder by exact folder_path membership (#844). " +
      "Does not include items in child folders (same rule as the host dashboard folder nav filter). " +
      "Empty folder returns []. Missing folder fails with Folder not found. " +
      "Returns index card ItemFile[] (not full markdown) — same hydrate surface as collector_search. " +
      "Thin client of FoldersPort.listFolderItems (same as CLI list-folder-items).",
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
    name: "collector_rename_folder",
    description:
      "Rename or relocate a vault folder by changing its path (FS rename + index id rewrite for items under the old prefix). " +
      "Returns { ok, path } with the normalized new path. " +
      "Same host path as collector_move_folder.",
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
      "Move a vault folder to a new path. Convenience alias of collector_rename_folder " +
      "(same renameFolder host path / semantics). " +
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
      "Recursively delete a vault folder: the folder tree, all nested subfolders, and every " +
      "item under that prefix (markdown + media + index). Fails if the folder is missing or is the vault root. " +
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
      "Move an item into a folder. Convenience alias of collector_update_item with folder_path " +
      "(same host move path / semantics). itemId is the vault-relative .md path; folderPath uses the same folder conventions as create. " +
      "Empty destination normalizes to Inbox. Item id changes to {folder}/{filename}.md. " +
      "Returns { ok, itemId, folder_path, item } where itemId is the **new** path after the move — use that for later get/update/delete.",
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
      "List media files attached to an item (MediaWithPath[]: id, filename, media_type, created_at, absolute_path). " +
      "Same listItemMedia service surface as the UI gallery. " +
      "Use media `id` values for replace/delete/set-cover. Cover auto-syncs after attach/delete/replace.",
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
      "Attach one media file to an existing item (same on-disk sidecar layout as UI upload). " +
      "Provide exactly one of dataBase64 or sourcePath. " +
      "filename is required with dataBase64; with sourcePath it defaults to the path basename. " +
      "Returns the created MediaFileMeta (stable media id). Auto-syncs item cover from first image/video.",
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
          "Original filename including extension (used for mime/type inference and on-disk name). " +
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
          "Absolute path on the Collector host filesystem to read bytes from. Mutually exclusive with dataBase64.",
      },
    ],
  },
  {
    name: "collector_replace_media",
    description:
      "Replace an existing media file's bytes (and optionally filename) while keeping the same media id. " +
      "Same replaceItemMedia host path as the shared API. Provide exactly one of dataBase64 or sourcePath. " +
      "Auto-syncs item cover afterward.",
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
          "Opaque media id from collector_list_item_media / collector_attach_media (UUID). Not an item path.",
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
          "Absolute host path to read replacement bytes from. Mutually exclusive with dataBase64.",
      },
    ],
  },
  {
    name: "collector_delete_media",
    description:
      "Delete one media file from an item by media id. Same deleteItemMedia path as the UI. " +
      "Auto-syncs item cover afterward (clears cover when no image/video remains).",
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
          "Opaque media id from list/attach (UUID). Not an item path.",
      },
    ],
  },
  {
    name: "collector_set_item_cover",
    description:
      "Manually regenerate the item cover.webp from a specific attached image or video " +
      "(same as the UI gallery star). Not required for a default cover — attach alone auto-syncs " +
      "from the first image/video. Subsequent attach/delete/replace may overwrite this choice via auto-sync.",
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
          "Opaque media id of an image or video attachment to use as cover source.",
      },
    ],
  },
  {
    name: "collector_discover_extract_candidates",
    description:
      "Discover extract candidates for one note by item id (load note body + frontmatter URL, " +
      "ask all registered extractor plugins). Returns ExtractCandidate[] " +
      "({ extractorId, url, optional meta }). Does not fetch or mutate the note. " +
      "Empty when no host extractors are registered or none match. " +
      "Use collector_extract_item_candidate with a returned candidate for the explicit extract action.",
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
      "Run an explicit extract for one candidate on an item (never auto on note open). " +
      "Passes extractorId/url/meta to the matching ExtractorPlugin. " +
      "Fails loudly when extractorId is unknown. " +
      "Prefer a candidate from collector_discover_extract_candidates; host plugins own fetch/merge.",
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
          "Registered extractor plugin id (e.g. from discover). Unknown ids fail loudly.",
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
          "Optional opaque per-extractor string map (e.g. shortcode). Omit when unused.",
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
