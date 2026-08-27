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
  "collector_get_item_source",
  "collector_update_item_source",
  "collector_wait_derived",
  "collector_delete_item",
  "collector_create_tag",
  "collector_delete_tag",
  "collector_create_folder",
  "collector_list_folders",
  "collector_list_folder_items",
  "collector_rename_folder",
  "collector_move_folder",
  "collector_delete_folder",
  "collector_move_item",
  "collector_list_item_media",
  "collector_attach_media",
  "collector_replace_media",
  "collector_delete_media",
  "collector_set_item_cover",
  "collector_discover_extract_candidates",
  "collector_extract_item_candidate",
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

  it("documents search as FTS returning paged ItemFile with total (#265 / #354 / #658)", () => {
    const search = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_search",
    );
    expect(search).toBeDefined();
    expect(search!.description).toMatch(/full-text|FTS/i);
    expect(search!.description).toMatch(/frontmatter/i);
    expect(search!.description).toMatch(/does not look up by item id/i);
    expect(search!.description).toMatch(/ItemFile/i);
    expect(search!.description).toMatch(/total/i);
    expect(search!.description).toMatch(/truncat/i);
    const query = search!.params.find((param) => param.name === "query");
    expect(query?.description).toMatch(/not an id or path lookup/i);
    expect(query?.description).toMatch(/frontmatter/i);
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

  it("exposes full UpdateItemInput on collector_update_item (#351)", () => {
    const update = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_update_item",
    );
    expect(update).toBeDefined();
    const names = update!.params.map((param) => param.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "itemId",
        "title",
        "description",
        "url",
        "content",
        "content_type",
        "tags",
        "folder_path",
      ]),
    );
  });

  it("documents move as alias of update folder_path and returns new id (#351 / #354)", () => {
    const move = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_move_item",
    );
    expect(move).toBeDefined();
    expect(move!.description).toMatch(/alias of collector_update_item/i);
    expect(move!.description).toMatch(/new.*path|itemId is the \*\*new\*\*/i);
  });

  it("exposes folder list/rename/move/delete (#352)", () => {
    const list = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_list_folders",
    );
    expect(list).toBeDefined();
    expect(list!.params).toEqual([]);

    const listItems = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_list_folder_items",
    );
    expect(listItems).toBeDefined();
    expect(listItems!.params.map((p) => p.name)).toEqual(["folderPath"]);
    expect(listItems!.description).toMatch(/exact folder_path/i);
    expect(listItems!.description).toMatch(/does not include/i);

    const rename = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_rename_folder",
    );
    expect(rename).toBeDefined();
    expect(rename!.params.map((p) => p.name)).toEqual(["oldPath", "newPath"]);

    const moveFolder = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_move_folder",
    );
    expect(moveFolder).toBeDefined();
    expect(moveFolder!.description).toMatch(/alias of collector_rename_folder/i);

    const del = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_delete_folder",
    );
    expect(del).toBeDefined();
    expect(del!.description).toMatch(/recursively delete/i);
  });

  it("exposes media list/attach/replace/delete/set-cover (#353)", () => {
    const list = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_list_item_media",
    );
    expect(list).toBeDefined();
    expect(list!.params.map((p) => p.name)).toEqual(["itemId"]);

    const attach = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_attach_media",
    );
    expect(attach).toBeDefined();
    expect(attach!.params.map((p) => p.name)).toEqual(
      expect.arrayContaining(["itemId", "filename", "dataBase64", "sourcePath"]),
    );
    expect(attach!.description).toMatch(/exactly one of dataBase64 or sourcePath/i);

    const replace = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_replace_media",
    );
    expect(replace).toBeDefined();
    expect(replace!.params.map((p) => p.name)).toEqual(
      expect.arrayContaining(["itemId", "mediaId", "dataBase64", "sourcePath"]),
    );

    const del = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_delete_media",
    );
    expect(del).toBeDefined();

    const cover = COLLECTOR_MCP_TOOLS.find(
      (tool) => tool.name === "collector_set_item_cover",
    );
    expect(cover).toBeDefined();
    expect(cover!.description).toMatch(/not required for a default cover/i);
  });
});
