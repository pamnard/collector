/**
 * Browser-safe MCP tool catalog for Settings → MCP.
 *
 * Re-exports the docs projection of `COLLECTOR_MCP_TOOL_DEFS` (zod-backed).
 * Do not import `mcp-tool-runs` / `server` from here — those pull Node.
 */

export {
  COLLECTOR_MCP_TOOLS,
  type CollectorMcpToolCatalogEntry,
  type CollectorMcpToolParam,
} from "./mcp-tool-defs.js";
