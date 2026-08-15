import { describe, expect, it } from "vitest";
import { buildFtsMatchQuery } from "../search/fts-query.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { createId } from "../util/ids.js";
import { upsertItem } from "../vault/item-operations.js";
import { createVault } from "../vault/vault-operations.js";
import { SqlVaultIndexStore } from "./sql-index.js";
import {
  createSqlIndexTestSuite,
  noteItemFields,
} from "./sql-index-test-harness.js";

describe("listItemIdsByNavFilter", () => {
  const suite = createSqlIndexTestSuite();
  suite.registerCleanup();

  it("returns ids for all items under the all filter", async () => {
    const { dataDir, fs } = await suite.openMemoryDataDir("collector-nav-filter-");
    const sql = new MemorySqlAdapter();
    const index = new SqlVaultIndexStore(sql);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    const firstId = `${createId()}.md`;
    const secondId = `${createId()}.md`;
    const timestamp = new Date().toISOString();

    for (const id of [firstId, secondId]) {
      await upsertItem(ctx, path, meta.id, {
        item: noteItemFields(meta.id, id, {
          created_at: timestamp,
          updated_at: timestamp,
        }),
      });
    }

    expect(await index.listItemIdsByNavFilter(meta.id, "all")).toEqual([
      firstId,
      secondId,
    ]);
  });

  it("folder nav filter lists only direct items, not nested descendants", async () => {
    const { index, ctx, vault } = await suite.openVaultIndex(
      "collector-nav-folder-exact-",
      "collector-nav-folder-exact.db",
    );
    const { meta, path } = vault;

    const parentId = `Parent/${createId()}.md`;
    const childId = `Parent/Child/${createId()}.md`;
    const timestamp = new Date().toISOString();
    const sharedToken = "ExactFolderToken";

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: parentId,
        vault_id: meta.id,
        title: "Parent note",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "Parent",
        content_revision: 1,
      word_count: 0,
      character_count: 0,
      created_at: timestamp,
        updated_at: timestamp,
      },
      content: sharedToken,
    });
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: childId,
        vault_id: meta.id,
        title: "Child note",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "Parent/Child",
        content_revision: 1,
      word_count: 0,
      character_count: 0,
      created_at: timestamp,
        updated_at: timestamp,
      },
      content: sharedToken,
    });

    const folderFilter = { type: "folder" as const, folderPath: "Parent" };

    expect(await index.listItemIdsByNavFilter(meta.id, folderFilter)).toEqual([
      parentId,
    ]);
    expect(await index.countItemIdsByNavFilter(meta.id, folderFilter)).toBe(1);

    const ftsQuery = buildFtsMatchQuery(sharedToken);
    expect(ftsQuery).not.toBeNull();
    expect(await index.searchItemIds(meta.id, ftsQuery!, folderFilter)).toEqual([
      parentId,
    ]);
    expect(await index.countSearchItemIds(meta.id, ftsQuery!, folderFilter)).toBe(
      1,
    );

    expect(await index.listItemIdsByFolderPrefix(meta.id, "Parent")).toEqual(
      expect.arrayContaining([parentId, childId]),
    );
    expect(
      (await index.listItemIdsByFolderPrefix(meta.id, "Parent")).length,
    ).toBe(2);

  });
});

describe("listItemIdsByNavFilter sort", () => {
  const suite = createSqlIndexTestSuite();
  suite.registerCleanup();

  it("orders by title and created_at and rejects unknown keys", async () => {
    const { index, ctx, vault } = await suite.openVaultIndex(
      "collector-nav-sort-",
      "collector-nav-sort.db",
    );
    const { meta, path } = vault;

    const older = "2020-01-01T00:00:00.000Z";
    const newer = "2021-01-01T00:00:00.000Z";
    const bananaId = `${createId()}.md`;
    const appleId = `${createId()}.md`;

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: bananaId,
        vault_id: meta.id,
        title: "Banana",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
      word_count: 0,
      character_count: 0,
      created_at: newer,
        updated_at: newer,
      },
    });
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: appleId,
        vault_id: meta.id,
        title: "Apple",
        description: "",
        content_type: "bookmark",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
      word_count: 0,
      character_count: 0,
      created_at: older,
        updated_at: older,
      },
    });

    expect(await index.listItemIdsByNavFilter(meta.id, "all")).toEqual([
      bananaId,
      appleId,
    ]);
    expect(
      await index.listItemIdsByNavFilter(meta.id, "all", {
        sort: { key: "created_at", dir: "asc" },
      }),
    ).toEqual([appleId, bananaId]);
    expect(
      await index.listItemIdsByNavFilter(meta.id, "all", {
        sort: { key: "title", dir: "asc" },
      }),
    ).toEqual([appleId, bananaId]);
    expect(
      await index.listItemIdsByNavFilter(meta.id, "all", {
        sort: { key: "title", dir: "desc" },
      }),
    ).toEqual([bananaId, appleId]);
    expect(
      await index.listItemIdsByNavFilter(meta.id, "all", {
        sort: { key: "content_type", dir: "asc" },
      }),
    ).toEqual([appleId, bananaId]);

    const page = await index.listItemIdsByNavFilter(meta.id, "all", {
      limit: 1,
      offset: 0,
      sort: { key: "title", dir: "asc" },
    });
    const page2 = await index.listItemIdsByNavFilter(meta.id, "all", {
      limit: 1,
      offset: 1,
      sort: { key: "title", dir: "asc" },
    });
    expect([...page, ...page2]).toEqual([appleId, bananaId]);

    await expect(
      index.listItemIdsByNavFilter(meta.id, "all", {
        sort: { key: "nope", dir: "asc" },
      }),
    ).rejects.toThrow(/Unsupported item id sort key/);

  });
});

describe("dashboard item id pagination", () => {
  const suite = createSqlIndexTestSuite();
  suite.registerCleanup();

  it("paginates nav filter ids and returns total count", async () => {
    const { index, ctx, vault } = await suite.openVaultIndex(
      "collector-nav-page-",
      "collector-nav-page.db",
    );
    const { meta, path } = vault;
    const timestamp = new Date().toISOString();
    const ids: string[] = [];

    for (let i = 0; i < 5; i += 1) {
      const id = `${createId()}.md`;
      ids.push(id);
      await upsertItem(ctx, path, meta.id, {
        item: {
          id,
          vault_id: meta.id,
          title: `Item ${i}`,
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
        properties: {},
          tag_ids: [],
          collection_ids: [],
          folder_path: "",
          content_revision: 1,
      word_count: 0,
      character_count: 0,
      created_at: new Date(Date.now() + i).toISOString(),
          updated_at: timestamp,
        },
      });
    }

    expect(await index.countItemIdsByNavFilter(meta.id, "all")).toBe(5);
    expect(
      await index.listItemIdsByNavFilter(meta.id, "all", { limit: 2, offset: 0 }),
    ).toHaveLength(2);
    expect(
      await index.listItemIdsByNavFilter(meta.id, "all", { limit: 2, offset: 2 }),
    ).toHaveLength(2);
    expect(
      await index.listItemIdsByNavFilter(meta.id, "all", { limit: 2, offset: 4 }),
    ).toHaveLength(1);
  });

  it("paginates FTS search ids and returns total count", async () => {
    const { index, ctx, vault } = await suite.openVaultIndex(
      "collector-search-page-",
      "collector.db",
    );
    const { meta } = vault;
    const timestamp = new Date().toISOString();

    for (const title of ["alpha one", "alpha two", "beta three"]) {
      const id = createId();
      const item = {
        id,
        vault_id: meta.id,
        title,
        description: "",
        content_type: "note" as const,
        source_type: "manual" as const,
        metadata: {},
        properties: {},
        tag_ids: [] as string[],
        collection_ids: [] as string[],
        folder_path: "",
        content_revision: 1,
      word_count: 0,
      character_count: 0,
      created_at: timestamp,
        updated_at: timestamp,
      };
      await index.upsertItemMetadata({ item, fileMtimeMs: 1 }, meta.id);
      await index.upsertItemContent({
        itemId: id,
        title,
        description: "",
        content: title,
        hasContentFile: true,
        sourceRef: null,
      });
    }

    const ftsQuery = "alpha";
    expect(await index.countSearchItemIds(meta.id, ftsQuery, "all")).toBe(2);
    expect(
      await index.searchItemIds(meta.id, ftsQuery, "all", { limit: 1, offset: 0 }),
    ).toHaveLength(1);
    expect(
      await index.searchItemIds(meta.id, ftsQuery, "all", { limit: 1, offset: 1 }),
    ).toHaveLength(1);
  });
});

describe("getAdjacentItems", () => {
  const suite = createSqlIndexTestSuite();
  suite.registerCleanup();

  it("returns exact-folder chronological neighbors with id tie-break", async () => {
    const { index, ctx, vault } = await suite.openVaultIndex(
      "collector-adjacent-",
      "collector-adjacent.db",
    );
    const { meta, path } = vault;

    const t1 = "2020-01-01T00:00:00.000Z";
    const t2 = "2020-06-01T00:00:00.000Z";
    const t3 = "2021-01-01T00:00:00.000Z";

    const olderId = "notes/11111111-1111-4111-8111-111111111111.md";
    const middleId = "notes/22222222-2222-4222-8222-222222222222.md";
    const newerId = "notes/33333333-3333-4333-8333-333333333333.md";
    const nestedId = "notes/sub/44444444-4444-4444-8444-444444444444.md";

    for (const [id, title, created_at, folder_path] of [
      [olderId, "Older", t1, "notes"],
      [middleId, "Middle", t2, "notes"],
      [newerId, "Newer", t3, "notes"],
      [nestedId, "Nested", t2, "notes/sub"],
    ] as const) {
      await upsertItem(ctx, path, meta.id, {
        item: {
          id,
          vault_id: meta.id,
          title,
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
        properties: {},
          tag_ids: [],
          collection_ids: [],
          folder_path,
          content_revision: 1,
          word_count: 0,
          character_count: 0,
          created_at,
          updated_at: created_at,
        },
      });
    }

    const middle = await index.getAdjacentItems(meta.id, {
      id: middleId,
      folder_path: "notes",
      created_at: t2,
    });
    expect(middle).toEqual({
      prev: { id: olderId, title: "Older" },
      next: { id: newerId, title: "Newer" },
    });

    const first = await index.getAdjacentItems(meta.id, {
      id: olderId,
      folder_path: "notes",
      created_at: t1,
    });
    expect(first).toEqual({
      prev: null,
      next: { id: middleId, title: "Middle" },
    });

    const last = await index.getAdjacentItems(meta.id, {
      id: newerId,
      folder_path: "notes",
      created_at: t3,
    });
    expect(last).toEqual({
      prev: { id: middleId, title: "Middle" },
      next: null,
    });

    const nested = await index.getAdjacentItems(meta.id, {
      id: nestedId,
      folder_path: "notes/sub",
      created_at: t2,
    });
    expect(nested).toEqual({ prev: null, next: null });
  });
});
