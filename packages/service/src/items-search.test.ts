import { describe, expect, it, vi } from "vitest";
import type { NavFilter } from "@collector/api";
import { queryDashboardIndexPage } from "./dashboard-index-page.js";
import {
  createItemsSearchService,
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
    listItemPresentationStampsByIds: vi.fn(async (_vaultId, itemIds) =>
      itemIds.map((_, i) => String(1000 + i)),
    ),
    listItemIdTitles: vi.fn(async () => []),
    listItemFtsBodies: vi.fn(async () => []),
    vaultItemsContentGeneration: vi.fn(async () => 0),
    getAdjacentItems: vi.fn(async () => ({ prev: null, next: null })),
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
      stamps: ["1000", "1001"],
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
      stamps: ["1000"],
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

  it("passes sort into listItemIdsByNavFilter options", async () => {
    const index = createIndexMock();
    const buildFts = vi.fn(() => "MATCH");
    const sort = { key: "title", dir: "asc" as const };

    await queryDashboardIndexPage(
      index,
      buildFts,
      "vault-1",
      filter,
      "",
      page,
      sort,
    );

    expect(index.listItemIdsByNavFilter).toHaveBeenCalledWith(
      "vault-1",
      filter,
      { ...page, sort },
    );
  });

  it("ignores sort on FTS search path", async () => {
    const index = createIndexMock();
    const buildFts = vi.fn(() => "hello*");
    const sort = { key: "title", dir: "asc" as const };

    await queryDashboardIndexPage(
      index,
      buildFts,
      "vault-1",
      filter,
      "hello",
      page,
      sort,
    );

    expect(index.searchItemIds).toHaveBeenCalledWith(
      "vault-1",
      "hello*",
      filter,
      page,
    );
    expect(index.listItemIdsByNavFilter).not.toHaveBeenCalled();
  });
});

function createSearchService(
  index: ItemsIndexPort,
  overrides: {
    kickoff?: ReturnType<typeof vi.fn>;
    buildSearchFtsQuery?: (q: string, vaultId: string) => string | null;
  } = {},
) {
  const vault = {
    id: "vault-1",
    name: "Vault",
    is_default: true,
    created_at: "a",
    updated_at: "a",
  };
  return createItemsSearchService({
    resolveActiveVault: async () => ({ vault: vault as never, path: "/vault" }),
    getContext: () => ({}) as never,
    getIndex: () => index,
    kickoffVaultIndexSync: overrides.kickoff ?? vi.fn(),
    buildSearchFtsQuery:
      overrides.buildSearchFtsQuery ?? (() => null),
    addVaultSyncListener: () => () => {},
    findSimilarItems: async () => [],
    normalizeMarkdown: (raw) => ({ text: raw, changed: false }),
  });
}

describe("createItemsSearchService.queryIndex", () => {
  it("kickoffs vault index sync before returning the page (#367)", async () => {
    const index = createIndexMock();
    const kickoff = vi.fn();

    const service = createSearchService(index, { kickoff });

    const result = await service.queryIndex("all", undefined, {
      limit: 60,
      offset: 0,
    });

    expect(kickoff).toHaveBeenCalledWith("vault-1", "/vault");
    expect(result).toEqual({
      ids: ["a.md", "b.md"],
      stamps: ["1000", "1001"],
      total: 2,
      offset: 0,
    });
  });
});

describe("createItemsSearchService.searchItems (#658)", () => {
  it("caps FTS hits to the default page size and hydrates via index cards", async () => {
    const manyIds = Array.from({ length: 120 }, (_, i) => `item-${i}.md`);
    const pageIds = manyIds.slice(0, 60);
    const searchItemIds = vi.fn(async (_v, _q, _f, page) => {
      expect(page).toEqual({ limit: 60, offset: 0 });
      return pageIds;
    });
    const countSearchItemIds = vi.fn(async () => 120);
    const listItemFilesByIds = vi.fn(async (_vaultId, itemIds: string[]) =>
      itemIds.map((id) => ({ id, title: id }) as never),
    );
    const listItemIdsByNavFilter = vi.fn(async () => manyIds);
    const index = createIndexMock({
      searchItemIds,
      countSearchItemIds,
      listItemFilesByIds,
      listItemIdsByNavFilter,
    });

    const service = createSearchService(index, {
      buildSearchFtsQuery: () => "hello*",
    });

    const result = await service.searchItems("hello", "all");

    expect(result.items).toHaveLength(60);
    expect(result.total).toBe(120);
    expect(result.offset).toBe(0);
    expect(searchItemIds).toHaveBeenCalledWith(
      "vault-1",
      "hello*",
      "all",
      { limit: 60, offset: 0 },
    );
    expect(countSearchItemIds).toHaveBeenCalledWith("vault-1", "hello*", "all");
    expect(listItemFilesByIds).toHaveBeenCalledWith("vault-1", pageIds);
    expect(listItemIdsByNavFilter).not.toHaveBeenCalled();
  });

  it("honors an explicit page and still hydrates only that id window", async () => {
    const searchItemIds = vi.fn(async () => ["c.md", "d.md"]);
    const countSearchItemIds = vi.fn(async () => 10);
    const listItemFilesByIds = vi.fn(async (_vaultId, itemIds: string[]) =>
      itemIds.map((id) => ({ id, title: id }) as never),
    );
    const index = createIndexMock({
      searchItemIds,
      countSearchItemIds,
      listItemFilesByIds,
    });
    const service = createSearchService(index, {
      buildSearchFtsQuery: () => "hello*",
    });

    const result = await service.searchItems("hello", "all", {
      limit: 2,
      offset: 4,
    });

    expect(result.items.map((i) => i.id)).toEqual(["c.md", "d.md"]);
    expect(result.total).toBe(10);
    expect(result.offset).toBe(4);
    expect(searchItemIds).toHaveBeenCalledWith("vault-1", "hello*", "all", {
      limit: 2,
      offset: 4,
    });
    expect(listItemFilesByIds).toHaveBeenCalledWith("vault-1", ["c.md", "d.md"]);
  });

  it("caps nav-list fallback when FTS query is null", async () => {
    const listItemIdsByNavFilter = vi.fn(async (_v, _f, page) => {
      expect(page).toEqual({ limit: 60, offset: 0 });
      return ["a.md", "b.md"];
    });
    const countItemIdsByNavFilter = vi.fn(async () => 2);
    const listItemFilesByIds = vi.fn(async (_vaultId, itemIds: string[]) =>
      itemIds.map((id) => ({ id, title: id }) as never),
    );
    const searchItemIds = vi.fn(async () => []);
    const index = createIndexMock({
      listItemIdsByNavFilter,
      countItemIdsByNavFilter,
      listItemFilesByIds,
      searchItemIds,
    });
    const service = createSearchService(index, {
      buildSearchFtsQuery: () => null,
    });

    const result = await service.searchItems("   ", "all");

    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(listItemIdsByNavFilter).toHaveBeenCalledWith("vault-1", "all", {
      limit: 60,
      offset: 0,
    });
    expect(listItemFilesByIds).toHaveBeenCalledWith("vault-1", ["a.md", "b.md"]);
    expect(searchItemIds).not.toHaveBeenCalled();
  });

  it("rejects invalid page limits and offsets", async () => {
    const index = createIndexMock();
    const service = createSearchService(index, {
      buildSearchFtsQuery: () => "hello*",
    });

    await expect(
      service.searchItems("hello", "all", { limit: Number.NaN, offset: 0 }),
    ).rejects.toThrow(/page\.limit/);
    await expect(
      service.searchItems("hello", "all", { limit: 0, offset: 0 }),
    ).rejects.toThrow(/page\.limit/);
    await expect(
      service.searchItems("hello", "all", { limit: 1.5, offset: 0 }),
    ).rejects.toThrow(/page\.limit/);
    await expect(
      service.searchItems("hello", "all", { limit: 401, offset: 0 }),
    ).rejects.toThrow(/exceeds max/);
    await expect(
      service.searchItems("hello", "all", { limit: 10, offset: -1 }),
    ).rejects.toThrow(/page\.offset/);
    await expect(
      service.searchItems("hello", "all", {
        limit: 10,
        offset: Number.POSITIVE_INFINITY,
      }),
    ).rejects.toThrow(/page\.offset/);
  });
});
