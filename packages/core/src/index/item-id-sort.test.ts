import { describe, expect, it } from "vitest";
import {
  DEFAULT_ITEM_ID_SORT,
  ITEM_ID_SORT_KEYS,
  isItemIdSortDir,
  isItemIdSortKey,
  primarySortDirForKey,
  resolveItemIdOrderByClause,
} from "./item-id-sort.js";

describe("item-id-sort", () => {
  it("exposes allowlisted keys matching registry sortKeys", () => {
    expect([...ITEM_ID_SORT_KEYS].sort()).toEqual([
      "content_type",
      "created_at",
      "title",
      "updated_at",
    ]);
  });

  it("defaults to created_at desc", () => {
    expect(DEFAULT_ITEM_ID_SORT).toEqual({ key: "created_at", dir: "desc" });
    expect(resolveItemIdOrderByClause()).toBe(
      "ORDER BY i.created_at DESC, i.id ASC",
    );
    expect(resolveItemIdOrderByClause(null)).toBe(
      "ORDER BY i.created_at DESC, i.id ASC",
    );
  });

  it("resolves allowlisted keys to safe SQL fragments", () => {
    expect(
      resolveItemIdOrderByClause({ key: "title", dir: "asc" }),
    ).toBe("ORDER BY i.title COLLATE NOCASE ASC, i.id ASC");
    expect(
      resolveItemIdOrderByClause({ key: "updated_at", dir: "desc" }),
    ).toBe("ORDER BY i.updated_at DESC, i.id ASC");
    expect(
      resolveItemIdOrderByClause({ key: "content_type", dir: "asc" }),
    ).toBe("ORDER BY i.content_type ASC, i.id ASC");
  });

  it("rejects unknown keys and dirs", () => {
    expect(() =>
      resolveItemIdOrderByClause({ key: "folder_path", dir: "asc" }),
    ).toThrow(/Unsupported item id sort key/);
    expect(() =>
      resolveItemIdOrderByClause({
        key: "title",
        dir: "sideways" as "asc",
      }),
    ).toThrow(/Unsupported item id sort dir/);
  });

  it("validates keys and dirs", () => {
    expect(isItemIdSortKey("title")).toBe(true);
    expect(isItemIdSortKey("tags")).toBe(false);
    expect(isItemIdSortDir("asc")).toBe(true);
    expect(isItemIdSortDir("DESC")).toBe(false);
  });

  it("picks primary UI dir per key", () => {
    expect(primarySortDirForKey("created_at")).toBe("desc");
    expect(primarySortDirForKey("updated_at")).toBe("desc");
    expect(primarySortDirForKey("title")).toBe("asc");
    expect(primarySortDirForKey("content_type")).toBe("asc");
  });
});
