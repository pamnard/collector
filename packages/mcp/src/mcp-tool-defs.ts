/**
 * MCP tool table: name + agent description + zod schema builders.
 * Browser-safe source of tool facts for Settings → MCP and registration.
 * Handlers live in `mcp-tool-runs.ts` (Node); registration zips both.
 */

import {
  mediaFileFields,
  mediaReplaceFileFields,
  projectToolsCatalog,
  type CollectorMcpToolCatalogEntry,
  type McpToolDef,
} from "./tool-params.js";

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

/**
 * One coherent definition per tool (name, description, input schema).
 * Adding a tool: append here and add the matching run in `mcp-tool-runs.ts`
 * (`satisfies` enforces the pair). Catalog params derive from zod.
 */
export const COLLECTOR_MCP_TOOL_DEFS = [
  {
    name: "collector_health",
    description:
      "Check whether the Collector service and vault are usable. " +
      "Returns { ok, status, open, healthy }. " +
      "Proceed with vault work only when ok and healthy are true.",
    buildSchema: () => ({}),
  },
  {
    name: "collector_search",
    description:
      "Full-text search across note text (frontmatter + body) plus title and description. " +
      "Does not look up by item id or path — searching a UUID or path will not find that item by identity. " +
      "Returns { items, total, offset } for one page (default 60). " +
      "When items.length < total, more matches exist — raise offset or tell the user. " +
      "Pass each hit’s `id` unchanged as itemId to get/update/delete/move.",
    buildSchema: (p) => ({
      query: p.requiredString(
        "Search text over note file contents (frontmatter + body) and title/description. " +
          "Not an id or path lookup.",
      ),
    }),
  },
  {
    name: "collector_get_item",
    description:
      "Get one item by id (metadata + markdown body). " +
      "itemId must be the full vault-relative .md path from search/create, not a bare UUID.",
    buildSchema: (p) => ({
      itemId: p.requiredString(ITEM_ID_DESCRIPTION),
    }),
  },
  {
    name: "collector_create_item",
    description:
      "Create an item in the active vault. Default type is note. " +
      "Omitting folder_path (or empty) creates under Inbox as {folder}/{uuid}.md. " +
      "Returns the created item; use its `id` path for later get/update/delete/move.",
    buildSchema: (p) => ({
      title: p.requiredString("Item title (non-empty)."),
      content_type: p.contentTypeDefaultNote(
        "One of: article, video, image, note, bookmark, pdf, audio, other. Defaults to note.",
      ),
      description: p.optionalString(
        "Short description / summary. Defaults to empty string.",
      ),
      url: p.nullableOptionalString(
        "Optional URL. Pass null or omit for no URL. On create, omitted becomes null.",
      ),
      content: p.nullableOptionalString(
        "Optional markdown body. Omit or null for an empty body.",
      ),
      folder_path: p.optionalString(FOLDER_PATH_DESCRIPTION),
    }),
  },
  {
    name: "collector_update_item",
    description:
      "Update fields on an existing item. Only the fields you pass change. " +
      "itemId is the vault-relative .md path. " +
      "Passing folder_path moves the item (same as collector_move_item). " +
      "url: omit to leave unchanged; null clears the URL. " +
      "tags are names (as in .md frontmatter); missing names are created on this write.",
    buildSchema: (p) => ({
      itemId: p.requiredString(ITEM_ID_DESCRIPTION),
      title: p.optionalString("New title. Omit to leave unchanged."),
      description: p.optionalString(
        "New description. Omit to leave unchanged.",
      ),
      url: p.nullableOptionalString(
        "New URL. Omit to leave unchanged; pass null to clear.",
      ),
      content: p.nullableOptionalString(
        "New markdown body. Omit to leave unchanged; null clears content.",
      ),
      content_type: p.contentTypeOptional(
        "New content type. One of: article, video, image, note, bookmark, pdf, audio, other. Omit to leave unchanged.",
      ),
      tags: p.optionalStringArray(
        "Replace item tags by name (as in vault .md frontmatter). " +
          "Missing names are created on this write — that is how tags enter the catalog. " +
          "Omit to leave unchanged; pass [] to clear all tags on the item.",
      ),
      folder_path: p.optionalString(
        "Move to this folder if different from current (same as collector_move_item). " +
          FOLDER_PATH_DESCRIPTION,
      ),
    }),
  },
  {
    name: "collector_get_item_source",
    description:
      "Read the raw vault .md file for an item (frontmatter + body). " +
      "Prefer collector_get_item / collector_update_item for field edits; use source for full-document round-trips.",
    buildSchema: (p) => ({
      itemId: p.requiredString(ITEM_ID_DESCRIPTION),
    }),
  },
  {
    name: "collector_update_item_source",
    description:
      "Replace the raw vault .md file for an item (frontmatter + body). " +
      "Tag names in frontmatter are applied (missing tags may be created). " +
      "itemId must be the full vault-relative path.",
    buildSchema: (p) => ({
      itemId: p.requiredString(ITEM_ID_DESCRIPTION),
      rawMarkdown: p.string(
        "Full markdown file contents including YAML frontmatter. Replaces the on-disk document.",
      ),
    }),
  },
  {
    name: "collector_wait_derived",
    description:
      "Wait until background work after a save has finished for one item revision " +
      "(search index / derived fields). Use when a later step needs that state ready. " +
      "Ordinary create/update does not require this. " +
      "Pass contentRevision from the item returned by create/update.",
    buildSchema: (p) => ({
      itemId: p.requiredString(ITEM_ID_DESCRIPTION),
      contentRevision: p.requiredInt(
        "content_revision from the save that started the background work.",
      ),
      timeoutMs: p.optionalPositiveNumber(
        "Optional wait limit in milliseconds (default 120000).",
      ),
    }),
  },
  {
    name: "collector_delete_item",
    description:
      "Delete an item by vault-relative .md path. itemId must be the full path from search/create, not a bare UUID.",
    buildSchema: (p) => ({
      itemId: p.requiredString(ITEM_ID_DESCRIPTION),
    }),
  },
  {
    name: "collector_create_folder",
    description:
      "Create a folder path in the active vault (no-op if it already exists after normalization). " +
      "Returns { ok, path } with the normalized path.",
    buildSchema: (p) => ({
      folderPath: p.requiredString(FOLDER_PATH_CREATE_DESCRIPTION),
    }),
  },
  {
    name: "collector_list_folders",
    description:
      "List the folder tree for the active vault " +
      "(each node: path, name, item_count, children). " +
      "Use paths from this tree for rename/move/delete folder tools.",
    buildSchema: () => ({}),
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
    buildSchema: (p) => ({
      folderPath: p.requiredString(FOLDER_PATH_CREATE_DESCRIPTION),
      sortKey: p.optionalString(
        "Sort field: title, created_at, updated_at, content_type, word_count, or character_count. " +
          "Must be paired with sortDir. Omit both for default (newest created_at first).",
      ),
      sortDir: p.optionalString(
        "Sort direction: asc or desc. Must be paired with sortKey. " +
          "Omit both for default (newest created_at first).",
      ),
    }),
  },
  {
    name: "collector_rename_folder",
    description:
      "Rename or move a vault folder to a new path. " +
      "Items under the old path keep working under the new path. " +
      "Returns { ok, path } with the normalized new path. " +
      "Same effect as collector_move_folder.",
    buildSchema: (p) => ({
      oldPath: p.requiredString(FOLDER_PATH_CREATE_DESCRIPTION),
      newPath: p.requiredString(FOLDER_PATH_CREATE_DESCRIPTION),
    }),
  },
  {
    name: "collector_move_folder",
    description:
      "Move a vault folder to a new path. Same as collector_rename_folder. " +
      "Returns { ok, path } with the normalized new path.",
    buildSchema: (p) => ({
      oldPath: p.requiredString(FOLDER_PATH_CREATE_DESCRIPTION),
      newPath: p.requiredString(FOLDER_PATH_CREATE_DESCRIPTION),
    }),
  },
  {
    name: "collector_delete_folder",
    description:
      "Recursively delete a vault folder: the folder, all nested subfolders, and every " +
      "item under that prefix (notes and media). Fails if the folder is missing or is the vault root. " +
      "Returns { ok, deleted } with the requested path.",
    buildSchema: (p) => ({
      folderPath: p.requiredString(FOLDER_PATH_CREATE_DESCRIPTION),
    }),
  },
  {
    name: "collector_move_item",
    description:
      "Move an item into a folder (same as collector_update_item with folder_path). " +
      "itemId is the vault-relative .md path. Empty destination becomes Inbox. " +
      "After the move the item id is {folder}/{filename}.md. " +
      "Returns { ok, itemId, folder_path, item } where itemId is the **new** path — use that afterward.",
    buildSchema: (p) => ({
      itemId: p.requiredString(ITEM_ID_DESCRIPTION),
      folderPath: p.requiredString(FOLDER_PATH_MOVE_DESCRIPTION),
    }),
  },
  {
    name: "collector_list_item_media",
    description:
      "List media files attached to an item " +
      "(id, filename, media_type, created_at, absolute_path). " +
      "Use each media `id` for replace/delete/set-cover. Cover updates automatically after attach/delete/replace.",
    buildSchema: (p) => ({
      itemId: p.requiredString(ITEM_ID_DESCRIPTION),
    }),
  },
  {
    name: "collector_attach_media",
    description:
      "Attach one media file to an existing item. " +
      "Provide exactly one of dataBase64 or sourcePath. " +
      "filename is required with dataBase64; with sourcePath it defaults to the path basename. " +
      "Returns the new media record (stable media id). Cover updates from the first image/video when needed.",
    buildSchema: (p) => ({
      itemId: p.requiredString(ITEM_ID_DESCRIPTION),
      ...mediaFileFields(p),
    }),
  },
  {
    name: "collector_replace_media",
    description:
      "Replace an existing media file’s bytes (and optionally filename) while keeping the same media id. " +
      "Provide exactly one of dataBase64 or sourcePath. Cover updates afterward.",
    buildSchema: (p) => ({
      itemId: p.requiredString(ITEM_ID_DESCRIPTION),
      mediaId: p.requiredString(
        "Media id from collector_list_item_media / collector_attach_media (UUID). Not an item path.",
      ),
      ...mediaReplaceFileFields(p),
    }),
  },
  {
    name: "collector_delete_media",
    description:
      "Delete one media file from an item by media id. " +
      "Cover updates afterward (cleared when no image/video remains).",
    buildSchema: (p) => ({
      itemId: p.requiredString(ITEM_ID_DESCRIPTION),
      mediaId: p.requiredString(
        "Media id from list/attach (UUID). Not an item path.",
      ),
    }),
  },
  {
    name: "collector_set_item_cover",
    description:
      "Set the item cover from a specific attached image or video. " +
      "Not required for a default cover — attach alone picks the first image/video. " +
      "Later attach/delete/replace may change the cover again automatically.",
    buildSchema: (p) => ({
      itemId: p.requiredString(ITEM_ID_DESCRIPTION),
      mediaId: p.requiredString(
        "Media id of an image or video attachment to use as the cover source.",
      ),
    }),
  },
  {
    name: "collector_discover_extract_candidates",
    description:
      "Discover extract options for one note (from body and frontmatter URL). " +
      "Returns candidates ({ extractorId, url, optional meta }). Does not fetch or change the note. " +
      "Empty when nothing matches. " +
      "Then call collector_extract_item_candidate with a returned candidate.",
    buildSchema: (p) => ({
      itemId: p.requiredString(ITEM_ID_DESCRIPTION),
    }),
  },
  {
    name: "collector_extract_item_candidate",
    description:
      "Run extract for one candidate on an item (never runs automatically on open). " +
      "Fails when extractorId is unknown. " +
      "Prefer a candidate from collector_discover_extract_candidates.",
    buildSchema: (p) => ({
      itemId: p.requiredString(ITEM_ID_DESCRIPTION),
      extractorId: p.requiredString(
        "Extractor id (e.g. from discover). Unknown ids fail.",
      ),
      url: p.requiredString(
        "URL to extract (from discover candidate). Non-empty string required.",
      ),
      meta: p.optionalStringRecord(
        "Optional string map for the extractor (e.g. shortcode). Omit when unused.",
      ),
    }),
  },
] as const satisfies readonly McpToolDef[];

/** Settings → MCP and docs tests: derived from the tool table (not a parallel list). */
export const COLLECTOR_MCP_TOOLS: readonly CollectorMcpToolCatalogEntry[] =
  projectToolsCatalog(COLLECTOR_MCP_TOOL_DEFS);

export type {
  CollectorMcpToolCatalogEntry,
  CollectorMcpToolParam,
} from "./tool-params.js";
export { createToolParams } from "./tool-params.js";
