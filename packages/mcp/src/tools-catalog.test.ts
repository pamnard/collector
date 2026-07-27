import { describe, expect, it } from "vitest";
import {
  COLLECTOR_MCP_TOOLS,
  requireMcpToolParamDescription,
} from "./tools-catalog.js";

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

describe("COLLECTOR_MCP_TOOLS catalog (#273 / #265)", () => {
  it("lists every registered MCP tool name exactly once", () => {
    const names = COLLECTOR_MCP_TOOLS.map((tool) => tool.name);
    expect(names).toEqual([...REGISTERED_TOOL_NAMES]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps non-empty agent descriptions on every tool and param", () => {
    for (const tool of COLLECTOR_MCP_TOOLS) {
      expect(tool.description.trim().length).toBeGreaterThan(40);
      for (const param of tool.params) {
        expect(param.description.trim().length).toBeGreaterThan(10);
        expect(
          requireMcpToolParamDescription(tool.name, param.name),
        ).toBe(param.description);
      }
    }
  });

  it("documents itemId as a vault-relative path, not a bare UUID (#265)", () => {
    const getItem = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_get_item",
    );
    expect(getItem).toBeDefined();
    const itemId = getItem!.params.find((param) => param.name === "itemId");
    expect(itemId?.description).toMatch(/vault-relative/i);
    expect(itemId?.description).toMatch(/not a bare UUID/i);
    expect(getItem!.description).toMatch(/not a bare UUID/i);
  });

  it("documents search as FTS, not id/path lookup (#265)", () => {
    const search = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_search",
    );
    expect(search).toBeDefined();
    expect(search!.description).toMatch(/full-text|FTS/i);
    expect(search!.description).toMatch(/does not look up by item id/i);
    const query = search!.params.find((param) => param.name === "query");
    expect(query?.description).toMatch(/not an id or path lookup/i);
  });

  it("documents tagId as UUID distinct from itemId (#265)", () => {
    const deleteTag = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_delete_tag",
    );
    expect(deleteTag).toBeDefined();
    const tagId = deleteTag!.params.find((param) => param.name === "tagId");
    expect(tagId?.description).toMatch(/UUID/i);
    expect(tagId?.description).toMatch(/not an item path/i);
  });
});
