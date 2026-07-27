/**
 * Browser-safe MCP tool catalog for Settings → MCP (#273).
 *
 * Agent-facing name/description live here; `server.ts` registers from the same
 * strings. Do not “improve” copy in this module — that is #265.
 */

export interface CollectorMcpToolParam {
  name: string;
  required: boolean;
  typeLabel: string;
}

export interface CollectorMcpToolCatalogEntry {
  name: string;
  description: string;
  params: CollectorMcpToolParam[];
}

/** Full tool list exposed to MCP clients and Settings UI. */
export const COLLECTOR_MCP_TOOLS: readonly CollectorMcpToolCatalogEntry[] = [
  {
    name: "collector_health",
    description: "Ping Collector service health over local IPC",
    params: [],
  },
  {
    name: "collector_search",
    description: "Search items in the active vault",
    params: [{ name: "query", required: true, typeLabel: "string" }],
  },
  {
    name: "collector_get_item",
    description: "Get an item by id (metadata + content)",
    params: [{ name: "itemId", required: true, typeLabel: "string" }],
  },
  {
    name: "collector_create_item",
    description: "Create an item via the Collector service",
    params: [
      { name: "title", required: true, typeLabel: "string" },
      { name: "content_type", required: false, typeLabel: "enum" },
      { name: "description", required: false, typeLabel: "string" },
      { name: "url", required: false, typeLabel: "string | null" },
      { name: "content", required: false, typeLabel: "string | null" },
      { name: "folder_path", required: false, typeLabel: "string" },
    ],
  },
  {
    name: "collector_update_item",
    description: "Update an item via the Collector service",
    params: [
      { name: "itemId", required: true, typeLabel: "string" },
      { name: "title", required: false, typeLabel: "string" },
      { name: "description", required: false, typeLabel: "string" },
      { name: "url", required: false, typeLabel: "string | null" },
      { name: "content", required: false, typeLabel: "string | null" },
      { name: "folder_path", required: false, typeLabel: "string" },
    ],
  },
  {
    name: "collector_delete_item",
    description: "Delete an item via the Collector service",
    params: [{ name: "itemId", required: true, typeLabel: "string" }],
  },
  {
    name: "collector_create_tag",
    description: "Create a tag via the Collector service",
    params: [
      { name: "name", required: true, typeLabel: "string" },
      { name: "color", required: false, typeLabel: "string | null" },
    ],
  },
  {
    name: "collector_delete_tag",
    description: "Delete a tag via the Collector service",
    params: [{ name: "tagId", required: true, typeLabel: "string" }],
  },
  {
    name: "collector_create_folder",
    description: "Create a folder path via the Collector service",
    params: [{ name: "folderPath", required: true, typeLabel: "string" }],
  },
  {
    name: "collector_move_item",
    description: "Move an item into a folder via the Collector service",
    params: [
      { name: "itemId", required: true, typeLabel: "string" },
      { name: "folderPath", required: true, typeLabel: "string" },
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
