import { describe, expect, it } from "vitest";
import { COLLECTOR_MCP_TOOLS } from "./tools-catalog.js";

/** Must match every `registerTool` name in `server.ts`. */
const REGISTERED_TOOL_NAMES = [
  "collector_health",
  "collector_search",
  "collector_get_item",
  "collector_create_item",
  "collector_update_item",
  "collector_delete_item",
  "collector_create_tag",
  "collector_delete_tag",
  "collector_create_folder",
  "collector_move_item",
] as const;

describe("COLLECTOR_MCP_TOOLS catalog (#273)", () => {
  it("lists every registered MCP tool name exactly once", () => {
    const names = COLLECTOR_MCP_TOOLS.map((tool) => tool.name);
    expect(names).toEqual([...REGISTERED_TOOL_NAMES]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps non-empty agent descriptions", () => {
    for (const tool of COLLECTOR_MCP_TOOLS) {
      expect(tool.description.trim().length).toBeGreaterThan(0);
    }
  });
});
