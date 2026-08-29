import { describe, expect, it, vi } from "vitest";
import { buildFtsMatchQuery, upsertItem } from "@collector/core";
import {
  createSqlIndexTestSuite,
  noteItemFields,
  type SqlIndexTestEnv,
} from "../../core/src/index/sql-index-test-harness.js";
import { createId } from "../../core/src/util/ids.js";
import {
  SEARCH_PAGE_SIZE,
  createItemsSearchService,
  queryDashboardIndexPage,
} from "./items-search.js";

const suite = createSqlIndexTestSuite();
suite.registerCleanup();

function createSearchService(
  env: SqlIndexTestEnv,
): ReturnType<typeof createItemsSearchService> {
  const { index, vault, ctx } = env;
  const { meta, path } = vault;
  return createItemsSearchService({
    resolveActiveVault: async () => ({ vault: meta, path }),
    getContext: () => ctx as never,
    getIndex: () => index as never,
    kickoffVaultIndexSync: vi.fn(),
    buildSearchFtsQuery: (q) => buildFtsMatchQuery(q),
    addVaultSyncListener: () => () => {},
    findSimilarItems: async () => [],
    normalizeMarkdown: (raw) => ({ text: raw, changed: false }),
    enqueueItemDerivedRefresh: async () => undefined,
    enqueueItemExtractAuto: async () => undefined,
  });
}

describe("createItemsSearchService.searchItems (#658) against real index", () => {
  it("finds seeded notes by FTS and hydrates titles from the index", async () => {
    const env = await suite.openVaultIndex(
      "collector-items-search-fts-",
      "items-search.db",
    );
    const { ctx, vault, index } = env;
    const { meta, path } = vault;
    const timestamp = "2026-01-01T00:00:00.000Z";
    const matchId = `${createId()}.md`;
    const otherId = `${createId()}.md`;

    await upsertItem(ctx, path, meta.id, {
      item: noteItemFields(meta.id, matchId, {
        title: "Alpha Teapot",
        created_at: timestamp,
        updated_at: timestamp,
      }),
      content: "unique_fts_token_alpha teapot body",
    });
    await upsertItem(ctx, path, meta.id, {
      item: noteItemFields(meta.id, otherId, {
        title: "Beta Mug",
        created_at: timestamp,
        updated_at: timestamp,
      }),
      content: "unrelated coffee notes",
    });

    const service = createSearchService(env);
    const result = await service.searchItems("unique_fts_token_alpha", "all");

    expect(result.items.map((item) => item.id)).toEqual([matchId]);
    expect(result.items[0]?.title).toBe("Alpha Teapot");
    expect(result.total).toBe(1);
    expect(result.offset).toBe(0);
    expect(await index.countSearchItemIds(
      meta.id,
      buildFtsMatchQuery("unique_fts_token_alpha")!,
      "all",
    )).toBe(1);
  });

  it("honors explicit page window on FTS hits", async () => {
    const env = await suite.openVaultIndex(
      "collector-items-search-page-",
      "items-search-page.db",
    );
    const { ctx, vault } = env;
    const { meta, path } = vault;
    const timestamp = "2026-01-01T00:00:00.000Z";
    const token = "page_window_token";
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = `${createId()}.md`;
      ids.push(id);
      await upsertItem(ctx, path, meta.id, {
        item: noteItemFields(meta.id, id, {
          title: `Note ${i}`,
          created_at: timestamp,
          updated_at: timestamp,
        }),
        content: `${token} body ${i}`,
      });
    }

    const service = createSearchService(env);
    const page = await service.searchItems(token, "all", {
      limit: 2,
      offset: 2,
    });

    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(5);
    expect(page.offset).toBe(2);
    expect(page.items.every((item) => ids.includes(item.id))).toBe(true);
  });

  it("falls back to nav list when the query builds no FTS match", async () => {
    const env = await suite.openVaultIndex(
      "collector-items-search-nav-",
      "items-search-nav.db",
    );
    const { ctx, vault } = env;
    const { meta, path } = vault;
    const timestamp = "2026-01-01T00:00:00.000Z";
    const firstId = `${createId()}.md`;
    const secondId = `${createId()}.md`;

    for (const id of [firstId, secondId]) {
      await upsertItem(ctx, path, meta.id, {
        item: noteItemFields(meta.id, id, {
          created_at: timestamp,
          updated_at: timestamp,
        }),
        content: "plain note",
      });
    }

    const service = createItemsSearchService({
      resolveActiveVault: async () => ({ vault: meta, path }),
      getContext: () => env.ctx as never,
      getIndex: () => env.index as never,
      kickoffVaultIndexSync: vi.fn(),
      buildSearchFtsQuery: () => null,
      addVaultSyncListener: () => () => {},
      findSimilarItems: async () => [],
      normalizeMarkdown: (raw) => ({ text: raw, changed: false }),
      enqueueItemDerivedRefresh: async () => undefined,
      enqueueItemExtractAuto: async () => undefined,
    });

    const result = await service.searchItems("   ", "all");
    expect(result.items.map((item) => item.id).sort()).toEqual(
      [firstId, secondId].sort(),
    );
    expect(result.total).toBe(2);
  });

  it("rejects invalid page limits and offsets", async () => {
    const env = await suite.openVaultIndex(
      "collector-items-search-page-guard-",
      "items-search-guard.db",
    );
    const service = createSearchService(env);

    await expect(
      service.searchItems("hello", "all", { limit: Number.NaN, offset: 0 }),
    ).rejects.toThrow(/page\.limit/);
    await expect(
      service.searchItems("hello", "all", { limit: 0, offset: 0 }),
    ).rejects.toThrow(/page\.limit/);
    await expect(
      service.searchItems("hello", "all", { limit: 401, offset: 0 }),
    ).rejects.toThrow(/exceeds max/);
    await expect(
      service.searchItems("hello", "all", { limit: 10, offset: -1 }),
    ).rejects.toThrow(/page\.offset/);
  });
});

describe("createItemsSearchService.queryIndex (#367)", () => {
  it("kickoffs vault index sync and returns ids from the real index", async () => {
    const env = await suite.openVaultIndex(
      "collector-items-query-index-",
      "items-query-index.db",
    );
    const { ctx, vault } = env;
    const { meta, path } = vault;
    const timestamp = "2026-01-01T00:00:00.000Z";
    const itemId = `${createId()}.md`;
    await upsertItem(ctx, path, meta.id, {
      item: noteItemFields(meta.id, itemId, {
        title: "Listed",
        created_at: timestamp,
        updated_at: timestamp,
      }),
    });

    const kickoff = vi.fn();
    const service = createItemsSearchService({
      resolveActiveVault: async () => ({ vault: meta, path }),
      getContext: () => env.ctx as never,
      getIndex: () => env.index as never,
      kickoffVaultIndexSync: kickoff,
      buildSearchFtsQuery: (q) => buildFtsMatchQuery(q),
      addVaultSyncListener: () => () => {},
      findSimilarItems: async () => [],
      normalizeMarkdown: (raw) => ({ text: raw, changed: false }),
      enqueueItemDerivedRefresh: async () => undefined,
      enqueueItemExtractAuto: async () => undefined,
    });

    const result = await service.queryIndex("all", undefined, {
      limit: SEARCH_PAGE_SIZE,
      offset: 0,
    });

    expect(kickoff).toHaveBeenCalledWith(meta.id, path);
    expect(result.ids).toEqual([itemId]);
    expect(result.total).toBe(1);
    expect(result.stamps).toHaveLength(1);
  });
});

describe("queryDashboardIndexPage against real index", () => {
  it("lists by nav filter when query is blank", async () => {
    const env = await suite.openVaultIndex(
      "collector-dash-index-blank-",
      "dash-index-blank.db",
    );
    const { ctx, vault, index } = env;
    const { meta, path } = vault;
    const timestamp = "2026-01-01T00:00:00.000Z";
    const firstId = `${createId()}.md`;
    const secondId = `${createId()}.md`;
    for (const id of [firstId, secondId]) {
      await upsertItem(ctx, path, meta.id, {
        item: noteItemFields(meta.id, id, {
          created_at: timestamp,
          updated_at: timestamp,
        }),
      });
    }

    const result = await queryDashboardIndexPage(
      index as never,
      buildFtsMatchQuery,
      meta.id,
      "all",
      "  ",
      { limit: 60, offset: 0 },
    );

    expect(result.itemIds.sort()).toEqual([firstId, secondId].sort());
    expect(result.totalCount).toBe(2);
  });

  it("uses FTS when the query matches seeded content", async () => {
    const env = await suite.openVaultIndex(
      "collector-dash-index-fts-",
      "dash-index-fts.db",
    );
    const { ctx, vault, index } = env;
    const { meta, path } = vault;
    const timestamp = "2026-01-01T00:00:00.000Z";
    const hitId = `${createId()}.md`;
    await upsertItem(ctx, path, meta.id, {
      item: noteItemFields(meta.id, hitId, {
        title: "Hit",
        created_at: timestamp,
        updated_at: timestamp,
      }),
      content: "dashboard_fts_needle_zzz",
    });
    await upsertItem(ctx, path, meta.id, {
      item: noteItemFields(meta.id, `${createId()}.md`, {
        title: "Miss",
        created_at: timestamp,
        updated_at: timestamp,
      }),
      content: "other",
    });

    const result = await queryDashboardIndexPage(
      index as never,
      buildFtsMatchQuery,
      meta.id,
      "all",
      "dashboard_fts_needle_zzz",
      { limit: 60, offset: 0 },
    );

    expect(result.itemIds).toEqual([hitId]);
    expect(result.totalCount).toBe(1);
  });
});
