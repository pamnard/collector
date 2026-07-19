import { describe, expect, it, vi } from "vitest";
import type { NavFilter } from "@collector/api";
import {
  queryDashboardIndexPage,
  type ItemsIndexPort,
} from "./items-search.js";

function createIndexMock(
  overrides: Partial<ItemsIndexPort> = {},
): ItemsIndexPort {
  return {
    listItemIdsByNavFilter: vi.fn(async () => ["a.md", "b.md"]),
    countItemIdsByNavFilter: vi.fn(async () => 2),
    searchItemIds: vi.fn(async () => ["a.md"]),
    countSearchItemIds: vi.fn(async () => 1),
    listItemFilesByIds: vi.fn(async () => []),
    ...overrides,
  };
}

describe("queryDashboardIndexPage", () => {
  const filter: NavFilter = "all";
  const page = { limit: 60, offset: 0 };

  it("lists by nav filter when query is empty", async () => {
    const index = createIndexMock();
    const buildFts = vi.fn(() => "MATCH");

    const result = await queryDashboardIndexPage(
      index,
      buildFts,
      "vault-1",
      filter,
      "  ",
      page,
    );

    expect(result).toEqual({
      itemIds: ["a.md", "b.md"],
      totalCount: 2,
      offset: 0,
    });
    expect(buildFts).not.toHaveBeenCalled();
    expect(index.searchItemIds).not.toHaveBeenCalled();
  });

  it("falls back to nav list when FTS query is null", async () => {
    const index = createIndexMock();
    const buildFts = vi.fn(() => null);

    const result = await queryDashboardIndexPage(
      index,
      buildFts,
      "vault-1",
      filter,
      "hello",
      page,
    );

    expect(result.itemIds).toEqual(["a.md", "b.md"]);
    expect(buildFts).toHaveBeenCalledWith("hello", "vault-1");
    expect(index.searchItemIds).not.toHaveBeenCalled();
  });

  it("uses search when FTS query is present", async () => {
    const index = createIndexMock();
    const buildFts = vi.fn(() => "hello*");

    const result = await queryDashboardIndexPage(
      index,
      buildFts,
      "vault-1",
      filter,
      "hello",
      page,
    );

    expect(result).toEqual({
      itemIds: ["a.md"],
      totalCount: 1,
      offset: 0,
    });
    expect(index.searchItemIds).toHaveBeenCalledWith(
      "vault-1",
      "hello*",
      filter,
      page,
    );
  });
});
