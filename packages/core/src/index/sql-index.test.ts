import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "@collector/db";
import { BetterSqliteMigrator } from "../../../db/src/testing/better-sqlite.js";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createVault, upsertItem } from "../vault/operations.js";
import { createTag } from "../vault/tag-operations.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { createId } from "../util/ids.js";

describe("listItemIdsByNavFilter", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("returns ids for all, favorite, and archived filters", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-nav-filter-"));
    const sql = new MemorySqlAdapter();
    const index = new SqlVaultIndexStore(sql);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    const activeId = createId();
    const favoriteId = createId();
    const archivedId = createId();
    const timestamp = new Date().toISOString();

    for (const [id, flags] of [
      [activeId, { is_archived: false, is_favorite: false }],
      [favoriteId, { is_archived: false, is_favorite: true }],
      [archivedId, { is_archived: true, is_favorite: false }],
    ] as const) {
      await upsertItem(ctx, path, meta.id, {
        item: {
          id,
          vault_id: meta.id,
          title: id,
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          is_archived: flags.is_archived,
          is_favorite: flags.is_favorite,
          tag_ids: [],
          collection_ids: [],
          folder_path: "",
          content_revision: 1,
          created_at: timestamp,
          updated_at: timestamp,
        },
      });
    }

    expect(await index.listItemIdsByNavFilter(meta.id, "all")).toEqual([
      activeId,
      favoriteId,
    ]);
    expect(await index.listItemIdsByNavFilter(meta.id, "favorite")).toEqual([
      favoriteId,
    ]);
    expect(await index.listItemIdsByNavFilter(meta.id, "archived")).toEqual([
      archivedId,
    ]);
  });
});

describe("dashboard item id pagination", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("paginates nav filter ids and returns total count", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-nav-page-"));
    const navDb = BetterSqliteMigrator.open(join(dataDir, "collector-nav-page.db"));
    await runMigrations(navDb);
    const index = new SqlVaultIndexStore(navDb);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const timestamp = new Date().toISOString();
    const ids: string[] = [];

    for (let i = 0; i < 5; i += 1) {
      const id = createId();
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
          is_archived: false,
          is_favorite: false,
          tag_ids: [],
          collection_ids: [],
          folder_path: "",
          content_revision: 1,
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
    navDb.close();
  });

  it("paginates FTS search ids and returns total count", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-search-page-"));
    const searchDb = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(searchDb);
    const index = new SqlVaultIndexStore(searchDb);
    const ctx = { fs, index };
    const { meta } = await createVault(ctx, dataDir, { name: "Vault" });
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
        is_archived: false,
        is_favorite: false,
        tag_ids: [] as string[],
        collection_ids: [] as string[],
        folder_path: "",
        content_revision: 1,
        created_at: timestamp,
        updated_at: timestamp,
      };
      await index.upsertItemMetadata({ item, fileMtimeMs: 1 }, meta.id);
      await index.upsertItemContent({
        itemId: id,
        title,
        description: "",
        content: title,
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
    searchDb.close();
  });
});

describe("listItemFilesByIds", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();
  let db: BetterSqliteMigrator | null = null;

  afterEach(async () => {
    db?.close();
    db = null;
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("returns ItemFile DTOs with tag_ids and collection_ids from SQL", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-list-item-files-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const index = new SqlVaultIndexStore(db);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    const tag = await createTag(ctx, path, meta.id, { name: "inbox" });
    const collectionId = createId();
    const firstId = createId();
    const secondId = createId();
    const missingId = createId();
    const timestamp = new Date().toISOString();

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: firstId,
        vault_id: meta.id,
        title: "First",
        description: "desc",
        url: "https://example.com/a",
        content_type: "bookmark",
        source_type: "manual",
        metadata: { k: 1 },
        thumbnail: "media/cover.webp",
        is_archived: false,
        is_favorite: true,
        tag_ids: [tag.id],
        collection_ids: [collectionId],
        folder_path: "work",
        content_revision: 2,
        created_at: timestamp,
        updated_at: timestamp,
      },
    });

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: secondId,
        vault_id: meta.id,
        title: "Second",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        is_archived: false,
        is_favorite: false,
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        created_at: timestamp,
        updated_at: timestamp,
      },
    });

    const loaded = await index.listItemFilesByIds(meta.id, [
      secondId,
      missingId,
      firstId,
    ]);

    expect(loaded.map((item) => item.id)).toEqual([secondId, firstId]);

    const first = loaded.find((item) => item.id === firstId)!;
    expect(first.title).toBe("First");
    expect(first.description).toBe("desc");
    expect(first.url).toBe("https://example.com/a");
    expect(first.content_type).toBe("bookmark");
    expect(first.thumbnail).toBe("media/cover.webp");
    expect(first.is_favorite).toBe(true);
    expect(first.folder_path).toBe("work");
    expect(first.metadata).toEqual({ k: 1 });
    expect(first.tag_ids).toEqual([tag.id]);
    expect(first.collection_ids).toEqual([collectionId]);
    expect(first.content_revision).toBe(2);

    const second = loaded.find((item) => item.id === secondId)!;
    expect(second.tag_ids).toEqual([]);
    expect(second.collection_ids).toEqual([]);

    const readTextCalls: string[] = [];
    const originalReadText = fs.readText.bind(fs);
    fs.readText = async (filePath: string) => {
      readTextCalls.push(filePath);
      return originalReadText(filePath);
    };
    try {
      await index.listItemFilesByIds(meta.id, [firstId, secondId]);
    } finally {
      fs.readText = originalReadText;
    }
    expect(readTextCalls.filter((p) => p.endsWith("item.json"))).toEqual([]);
  });
});

describe("upsertItemMetadata / upsertItemContent", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();
  let db: BetterSqliteMigrator | null = null;

  afterEach(async () => {
    db?.close();
    db = null;
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("writes list fields in metadata phase and FTS body in content phase", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-phased-upsert-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const index = new SqlVaultIndexStore(db);
    const ctx = { fs, index };
    const { meta } = await createVault(ctx, dataDir, { name: "Vault" });

    const itemId = createId();
    const timestamp = new Date().toISOString();
    const item = {
      id: itemId,
      vault_id: meta.id,
      title: "MetaTitle",
      description: "MetaDesc",
      content_type: "note" as const,
      source_type: "manual" as const,
      metadata: {},
      is_archived: false,
      is_favorite: false,
      tag_ids: [] as string[],
      collection_ids: [] as string[],
      folder_path: "",
      content_revision: 1,
      created_at: timestamp,
      updated_at: timestamp,
    };

    await index.upsertItemMetadata({ item, fileMtimeMs: 42 }, meta.id);

    const afterMeta = await db.select<{ has_content_file: number }>(
      "SELECT has_content_file FROM items WHERE id = ?",
      [itemId],
    );
    expect(afterMeta[0]?.has_content_file).toBe(0);

    const ftsMeta = await db.select<{ content: string }>(
      "SELECT content FROM items_fts WHERE item_id = ?",
      [itemId],
    );
    expect(ftsMeta[0]?.content).toBe("");

    await index.upsertItemContent({
      itemId,
      title: item.title,
      description: item.description,
      content: "full body text",
      sourceRef: null,
    });

    const afterContent = await db.select<{ has_content_file: number }>(
      "SELECT has_content_file FROM items WHERE id = ?",
      [itemId],
    );
    expect(afterContent[0]?.has_content_file).toBe(1);

    const ftsContent = await db.select<{ content: string }>(
      "SELECT content FROM items_fts WHERE item_id = ?",
      [itemId],
    );
    expect(ftsContent[0]?.content).toBe("full body text");
  });
});
