import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@collector/db";
import { BetterSqliteMigrator } from "../../../db/src/testing/better-sqlite.js";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createVault } from "../vault/vault-operations.js";
import { upsertItem } from "../vault/item-operations.js";
import { createTag } from "../vault/tag-operations.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { createId } from "../util/ids.js";
import {
  buildFtsMatchQuery,
  buildMetadataFtsMatchQuery,
} from "../search/fts-query.js";
import {
  EMBEDDING_DIMS,
  EMBEDDING_MODEL_ID,
} from "../embeddings/constants.js";
import {
  getItemEmbedding,
  putItemEmbedding,
} from "../embeddings/embedding-store.js";
import { SQL_INSERT_CHUNK } from "./sql-index-helpers.js";

describe("listItemIdsByNavFilter", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("returns ids for all items under the all filter", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-nav-filter-"));
    const sql = new MemorySqlAdapter();
    const index = new SqlVaultIndexStore(sql);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    const firstId = `${createId()}.md`;
    const secondId = `${createId()}.md`;
    const timestamp = new Date().toISOString();

    for (const id of [firstId, secondId]) {
      await upsertItem(ctx, path, meta.id, {
        item: {
          id,
          vault_id: meta.id,
          title: id,
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
      created_at: timestamp,
          updated_at: timestamp,
        },
      });
    }

    expect(await index.listItemIdsByNavFilter(meta.id, "all")).toEqual([
      firstId,
      secondId,
    ]);
  });

  it("folder nav filter lists only direct items, not nested descendants", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-nav-folder-exact-"));
    const db = BetterSqliteMigrator.open(join(dataDir, "collector-nav-folder-exact.db"));
    await runMigrations(db);
    const index = new SqlVaultIndexStore(db);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

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

    db.close();
  });
});

describe("listItemIdsByNavFilter sort", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("orders by title and created_at and rejects unknown keys", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-nav-sort-"));
    const sortDb = BetterSqliteMigrator.open(join(dataDir, "collector-nav-sort.db"));
    await runMigrations(sortDb);
    const index = new SqlVaultIndexStore(sortDb);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

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

    sortDb.close();
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
    searchDb.close();
  });
});

describe("listItemPresentationStampsByIds", () => {
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

  it("returns file_mtime_ms stamps in id order and fails on missing mtime", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-presentation-stamps-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const index = new SqlVaultIndexStore(db);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const timestamp = new Date().toISOString();
    const firstId = `Inbox/${createId()}.md`;
    const secondId = `Inbox/${createId()}.md`;

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: firstId,
        vault_id: meta.id,
        title: "First",
        description: "",
        url: null,
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "Inbox",
        content_revision: 1,
      word_count: 0,
      character_count: 0,
      created_at: timestamp,
        updated_at: timestamp,
      },
      content: "one",
    });
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: secondId,
        vault_id: meta.id,
        title: "Second",
        description: "",
        url: null,
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "Inbox",
        content_revision: 1,
      word_count: 0,
      character_count: 0,
      created_at: timestamp,
        updated_at: timestamp,
      },
      content: "two",
    });

    const stamps = await index.listItemPresentationStampsByIds(meta.id, [
      secondId,
      firstId,
    ]);
    expect(stamps).toHaveLength(2);
    expect(Number(stamps[0])).toBeGreaterThan(0);
    expect(Number(stamps[1])).toBeGreaterThan(0);
    expect(stamps[0]).not.toEqual(stamps[1]);

    await expect(
      index.listItemPresentationStampsByIds(meta.id, ["missing.md"]),
    ).rejects.toThrow(/Missing index row/);
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
    const firstId = `work/${createId()}.md`;
    const secondId = `${createId()}.md`;
    const missingId = `${createId()}.md`;
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
        properties: {},
        thumbnail: "media/cover.webp",
        tag_ids: [tag.id],
        collection_ids: [collectionId],
        folder_path: "work",
        content_revision: 2,
      word_count: 0,
      character_count: 0,
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
        properties: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
      word_count: 0,
      character_count: 0,
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

  it("skips a row with corrupt metadata_json without failing the batch", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-list-corrupt-meta-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const index = new SqlVaultIndexStore(db);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const firstId = `${createId()}.md`;
    const secondId = `${createId()}.md`;
    const timestamp = new Date().toISOString();

    for (const itemId of [firstId, secondId]) {
      await upsertItem(ctx, path, meta.id, {
        item: {
          id: itemId,
          vault_id: meta.id,
          title: itemId === firstId ? "First" : "Second",
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: { ok: true },
          properties: {},
          tag_ids: [],
          collection_ids: [],
          folder_path: "",
          content_revision: 1,
      word_count: 0,
      character_count: 0,
      created_at: timestamp,
          updated_at: timestamp,
        },
      });
    }

    await db.execute("UPDATE items SET metadata_json = ? WHERE id = ?", [
      "not-json",
      firstId,
    ]);

    const loaded = await index.listItemFilesByIds(meta.id, [firstId, secondId]);
    expect(loaded.map((item) => item.id)).toEqual([secondId]);
  });

  it("multi-chunk hydrate returns same ordered set as a single request (#666)", async () => {
    const { SQL_IN_LIST_CHUNK } = await import("./sql-index-helpers.js");
    dataDir = await mkdtemp(join(tmpdir(), "collector-list-chunk-order-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const index = new SqlVaultIndexStore(db);
    const ctx = { fs, index };
    const { meta } = await createVault(ctx, dataDir, { name: "Vault" });
    const timestamp = new Date().toISOString();
    const count = SQL_IN_LIST_CHUNK + 5;
    const ids = Array.from({ length: count }, (_, i) => `n${String(i).padStart(4, "0")}.md`);

    for (const itemId of ids) {
      await db.execute(
        `INSERT INTO items (
           id, vault_id, title, description, url, content_type, source_type,
           source_id, metadata_json, properties_json, thumbnail_path,
           has_content_file, sort_order, folder_path, created_at, updated_at,
           file_mtime_ms, content_revision, word_count, character_count
         ) VALUES (?, ?, ?, '', NULL, 'note', 'manual', NULL, '{}', '{}', NULL, 0, 0, '', ?, ?, NULL, 1, 0, 0)`,
        [itemId, meta.id, itemId, timestamp, timestamp],
      );
    }

    const requestOrder = [...ids].reverse();
    const loaded = await index.listItemFilesByIds(meta.id, requestOrder);
    expect(loaded.map((item) => item.id)).toEqual(requestOrder);
  });

  it("pathological large id list chunks IN binds under SQL_IN_LIST_CHUNK (#666)", async () => {
    const { SQL_IN_LIST_CHUNK } = await import("./sql-index-helpers.js");
    dataDir = await mkdtemp(join(tmpdir(), "collector-list-bind-safe-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const index = new SqlVaultIndexStore(db);
    const ctx = { fs, index };
    const { meta } = await createVault(ctx, dataDir, { name: "Vault" });
    const timestamp = new Date().toISOString();
    const count = SQL_IN_LIST_CHUNK * 2 + 7;
    const ids = Array.from({ length: count }, (_, i) => `b${String(i).padStart(4, "0")}.md`);

    for (let offset = 0; offset < ids.length; offset += 50) {
      const slice = ids.slice(offset, offset + 50);
      const placeholders = slice
        .map(
          () =>
            "(?, ?, ?, '', NULL, 'note', 'manual', NULL, '{}', '{}', NULL, 0, 0, '', ?, ?, NULL, 1, 0, 0)",
        )
        .join(", ");
      const binds = slice.flatMap((itemId) => [
        itemId,
        meta.id,
        itemId,
        timestamp,
        timestamp,
      ]);
      await db.execute(
        `INSERT INTO items (
           id, vault_id, title, description, url, content_type, source_type,
           source_id, metadata_json, properties_json, thumbnail_path,
           has_content_file, sort_order, folder_path, created_at, updated_at,
           file_mtime_ms, content_revision, word_count, character_count
         ) VALUES ${placeholders}`,
        binds,
      );
    }

    const inBindCounts: number[] = [];
    const underlying = db.select.bind(db);
    db.select = async <T>(query: string, bindValues: unknown[] = []) => {
      if (String(query).includes(" IN (")) {
        const inCount = String(query).includes("vault_id")
          ? bindValues.length - 1
          : bindValues.length;
        inBindCounts.push(inCount);
      }
      return underlying<T>(query, bindValues);
    };

    const loaded = await index.listItemFilesByIds(meta.id, ids);
    expect(loaded.map((item) => item.id)).toEqual(ids);
    expect(inBindCounts.length).toBeGreaterThan(1);
    expect(Math.max(...inBindCounts)).toBeLessThanOrEqual(SQL_IN_LIST_CHUNK);
  });

  it("rejects absurd id list sizes without silent truncation (#666)", async () => {
    const { SQL_IN_LIST_MAX } = await import("./sql-index-helpers.js");
    dataDir = await mkdtemp(join(tmpdir(), "collector-list-absurd-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const index = new SqlVaultIndexStore(db);
    const ctx = { fs, index };
    const { meta } = await createVault(ctx, dataDir, { name: "Vault" });
    const ids = Array.from({ length: SQL_IN_LIST_MAX + 1 }, (_, i) => `${i}.md`);
    await expect(index.listItemFilesByIds(meta.id, ids)).rejects.toThrow(
      /exceeds max/,
    );
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
    expect(ftsMeta).toEqual([]);

    await index.upsertItemContent({
      itemId,
      title: item.title,
      description: item.description,
      content: "full body text",
      hasContentFile: true,
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

  it("FTS finds a token present only in frontmatter (#534)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-fts-fm-only-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const index = new SqlVaultIndexStore(db);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const fmToken = "FmOnlySecretToken534";
    const itemId = `${createId()}.md`;
    const timestamp = new Date().toISOString();
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Body free title",
        description: "plain desc",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: { foreign_key: fmToken },
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
      word_count: 0,
      character_count: 0,
      created_at: timestamp,
        updated_at: timestamp,
      },
      content: "body without the secret token",
    });

    const ftsQuery = buildFtsMatchQuery(fmToken);
    expect(ftsQuery).not.toBeNull();
    expect(await index.searchItemIds(meta.id, ftsQuery!, "all")).toEqual([itemId]);

    const ftsRows = await db.select<{ content: string }>(
      "SELECT content FROM items_fts WHERE item_id = ?",
      [itemId],
    );
    expect(ftsRows[0]?.content).toContain(fmToken);
    expect(ftsRows[0]?.content).toContain("---");
  });

  it("does not set has_content_file from frontmatter-only FTS document", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-fts-fm-flag-"));
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
    await index.upsertItemMetadata({ item, fileMtimeMs: 42 }, meta.id);
    const fmOnlyDoc = [
      "---",
      "title: MetaTitle",
      "unique_fm_token: FmOnlySecretToken534",
      "---",
      "",
    ].join("\n");
    await index.upsertItemContent({
      itemId,
      title: item.title,
      description: item.description,
      content: fmOnlyDoc,
      hasContentFile: false,
      sourceRef: null,
    });
    const afterContent = await db.select<{ has_content_file: number }>(
      "SELECT has_content_file FROM items WHERE id = ?",
      [itemId],
    );
    expect(afterContent[0]?.has_content_file).toBe(0);
  });

  it("writes FTS tokens only after the content phase", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-metadata-fts-search-"));
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
      title: "VisibleTitle",
      description: "VisibleDesc",
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

    const titleQuery = buildMetadataFtsMatchQuery("VisibleTitle");
    const contentToken = "SecretBody";
    const contentQuery = buildMetadataFtsMatchQuery(contentToken);
    expect(titleQuery).not.toBeNull();
    expect(contentQuery).not.toBeNull();
    expect(await index.searchItemIds(meta.id, titleQuery!, "all")).toEqual([]);
    expect(await index.searchItemIds(meta.id, contentQuery!, "all")).toEqual(
      [],
    );

    await index.upsertItemContent({
      itemId,
      title: item.title,
      description: item.description,
      content: `note ${contentToken} text`,
      hasContentFile: true,
      sourceRef: null,
    });

    const fullContentQuery = buildFtsMatchQuery(contentToken);
    expect(fullContentQuery).not.toBeNull();
    expect(await index.searchItemIds(meta.id, fullContentQuery!, "all")).toEqual(
      [itemId],
    );
    expect(await index.searchItemIds(meta.id, contentQuery!, "all")).toEqual([]);
  });

  it("uses constant SQL executes for a metadata batch", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-metadata-batch-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const index = new SqlVaultIndexStore(db);
    const ctx = { fs, index };
    const { meta } = await createVault(ctx, dataDir, { name: "Vault" });
    const timestamp = new Date().toISOString();
    const records = Array.from({ length: 32 }, () => ({
      item: {
        id: createId(),
        vault_id: meta.id,
        title: "Batch item",
        description: "",
        content_type: "note" as const,
        source_type: "manual" as const,
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
      word_count: 0,
      character_count: 0,
      created_at: timestamp,
        updated_at: timestamp,
      },
      fileMtimeMs: 1,
    }));

    let executeCalls = 0;
    const underlying = db.execute.bind(db);
    db.execute = async (query: string, bindValues?: unknown[]) => {
      executeCalls += 1;
      return underlying(query, bindValues);
    };

    await index.upsertItemMetadataBatch(records, meta.id);

    expect(executeCalls).toBe(3);
    expect(executeCalls).toBeLessThan(records.length * 3);
  });

  it("batch-inserts tags and collections in O(1) SQL round-trips per relation", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-batch-upsert-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const index = new SqlVaultIndexStore(db);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    const tagCount = 5;
    const collectionCount = 4;
    const tags = await Promise.all(
      Array.from({ length: tagCount }, (_, i) =>
        createTag(ctx, path, meta.id, { name: `tag-${i}` }),
      ),
    );
    const collectionIds = Array.from({ length: collectionCount }, () => createId());
    const itemId = createId();
    const timestamp = new Date().toISOString();

    let executeCalls = 0;
    const underlying = db.execute.bind(db);
    db.execute = async (query: string, bindValues?: unknown[]) => {
      executeCalls += 1;
      return underlying(query, bindValues);
    };

    await index.upsertItemMetadata(
      {
        item: {
          id: itemId,
          vault_id: meta.id,
          title: "Batch",
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
        properties: {},
          tag_ids: tags.map((tag) => tag.id),
          collection_ids: collectionIds,
          folder_path: "",
          content_revision: 1,
      word_count: 0,
      character_count: 0,
      created_at: timestamp,
          updated_at: timestamp,
        },
        fileMtimeMs: 1,
      },
      meta.id,
    );

    // items upsert + delete tags + batch insert tags + delete collections +
    // batch stub collections + batch item_collections
    expect(executeCalls).toBe(6);

    const tagRows = await db.select<{ tag_id: string }>(
      "SELECT tag_id FROM item_tags WHERE item_id = ? ORDER BY tag_id",
      [itemId],
    );
    expect(tagRows.map((row) => row.tag_id).sort()).toEqual(
      tags.map((tag) => tag.id).sort(),
    );

    const collectionRows = await db.select<{ collection_id: string }>(
      "SELECT collection_id FROM item_collections WHERE item_id = ? ORDER BY collection_id",
      [itemId],
    );
    expect(collectionRows.map((row) => row.collection_id).sort()).toEqual(
      [...collectionIds].sort(),
    );

    executeCalls = 0;
    await index.upsertItemMetadata(
      {
        item: {
          id: itemId,
          vault_id: meta.id,
          title: "Batch",
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
        properties: {},
          tag_ids: [tags[0]!.id],
          collection_ids: [],
          folder_path: "",
          content_revision: 1,
      word_count: 0,
      character_count: 0,
      created_at: timestamp,
          updated_at: timestamp,
        },
        fileMtimeMs: 1,
      },
      meta.id,
    );

    // Empty relation lists skip relation inserts.
    expect(executeCalls).toBe(4);

    const replacedTags = await db.select<{ tag_id: string }>(
      "SELECT tag_id FROM item_tags WHERE item_id = ?",
      [itemId],
    );
    expect(replacedTags).toEqual([{ tag_id: tags[0]!.id }]);

    const clearedCollections = await db.select<{ collection_id: string }>(
      "SELECT collection_id FROM item_collections WHERE item_id = ?",
      [itemId],
    );
    expect(clearedCollections).toEqual([]);
  });

  it("updates created_at on metadata upsert conflict", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-upsert-created-at-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const index = new SqlVaultIndexStore(db);
    const ctx = { fs, index };
    const { meta } = await createVault(ctx, dataDir, { name: "Vault" });

    const itemId = createId();
    const firstCreated = "2020-01-01T00:00:00.000Z";
    const secondCreated = "2024-06-15T12:00:00.000Z";
    const updatedAt = "2024-06-15T12:00:00.000Z";
    const base = {
      id: itemId,
      vault_id: meta.id,
      title: "Note",
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
      updated_at: updatedAt,
    };

    await index.upsertItemMetadata(
      { item: { ...base, created_at: firstCreated }, fileMtimeMs: 1 },
      meta.id,
    );
    await index.upsertItemMetadata(
      { item: { ...base, created_at: secondCreated }, fileMtimeMs: 1 },
      meta.id,
    );

    const rows = await db.select<{ created_at: string }>(
      "SELECT created_at FROM items WHERE id = ?",
      [itemId],
    );
    expect(rows[0]?.created_at).toBe(secondCreated);
  });
});

describe("listItemSyncMetaByIds", () => {
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

  it("returns only requested ids and empty for empty input", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-sync-meta-by-ids-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const index = new SqlVaultIndexStore(db);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const timestamp = new Date().toISOString();
    const firstId = `${createId()}.md`;
    const secondId = `${createId()}.md`;
    const thirdId = `${createId()}.md`;

    for (const itemId of [firstId, secondId, thirdId]) {
      await upsertItem(ctx, path, meta.id, {
        item: {
          id: itemId,
          vault_id: meta.id,
          title: itemId,
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
        properties: {},
          tag_ids: [],
          collection_ids: [],
          content_revision: 1,
      word_count: 0,
      character_count: 0,
      created_at: timestamp,
          updated_at: timestamp,
        },
        content: "body",
      });
    }

    expect(await index.listItemSyncMetaByIds(meta.id, [])).toEqual([]);

    const subset = await index.listItemSyncMetaByIds(meta.id, [
      secondId,
      `${createId()}.md`,
      firstId,
    ]);
    expect(subset.map((row) => row.id).sort()).toEqual(
      [firstId, secondId].sort(),
    );
    expect(subset.every((row) => typeof row.updated_at === "string")).toBe(true);
  });
});

describe("rewriteItemIds", () => {
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

  it("rewrites item PK and preserves tags, media, and FTS body", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-rewrite-ids-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const index = new SqlVaultIndexStore(db);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const tag = await createTag(ctx, path, meta.id, { name: "keep" });

    const oldId = `Old/${createId()}.md`;
    const newId = oldId.replace("Old/", "New/");
    const timestamp = new Date().toISOString();
    const mediaId = createId();

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: oldId,
        vault_id: meta.id,
        title: "Rewrite me",
        description: "desc",
        content_type: "note",
        source_type: "manual",
        metadata: { k: 1 },
        properties: {},
        tag_ids: [tag.id],
        collection_ids: [],
        folder_path: "Old",
        content_revision: 2,
      word_count: 0,
      character_count: 0,
      created_at: timestamp,
        updated_at: timestamp,
      },
      content: "fts body content uniquephrase",
    });
    await index.upsertMedia({
      id: mediaId,
      item_id: oldId,
      filename: "shot.png",
      media_type: "image",
      created_at: timestamp,
    });

    await index.rewriteItemIds([
      { oldId, newId, folderPath: "New" },
    ]);

    expect(await index.listVaultItemIds(meta.id)).toEqual([newId]);
    expect(await index.listItemIdsByFolderPrefix(meta.id, "Old")).toEqual([]);
    expect(await index.listItemIdsByFolderPrefix(meta.id, "New")).toEqual([
      newId,
    ]);
    expect(await index.listItemIdsByTag(meta.id, tag.id)).toEqual([newId]);

    const mediaRows = await db.select<{ item_id: string; filename: string }>(
      "SELECT item_id, filename FROM media WHERE id = ?",
      [mediaId],
    );
    expect(mediaRows).toEqual([{ item_id: newId, filename: "shot.png" }]);

    const ftsHits = await index.searchItemIds(
      meta.id,
      "uniquephrase",
      "all",
    );
    expect(ftsHits).toEqual([newId]);

    const loaded = await index.listItemFilesByIds(meta.id, [newId]);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.folder_path).toBe("New");
    expect(loaded[0]?.tag_ids).toEqual([tag.id]);
    expect(loaded[0]?.title).toBe("Rewrite me");
  });

  it("rewrites multiple folder items with shared SQL batches (#662)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-rewrite-batch-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const index = new SqlVaultIndexStore(db);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const tag = await createTag(ctx, path, meta.id, { name: "batch-tag" });
    const timestamp = new Date().toISOString();
    const collectionId = createId();

    const mappings = Array.from({ length: 4 }, (_, i) => {
      const oldId = `Old/${createId()}.md`;
      return {
        oldId,
        newId: oldId.replace("Old/", "New/"),
        folderPath: "New",
        phrase: `batchphrase${i}`,
        mediaId: createId(),
        sourceExternalId: `ext-${i}`,
      };
    });

    for (const mapping of mappings) {
      await upsertItem(ctx, path, meta.id, {
        item: {
          id: mapping.oldId,
          vault_id: meta.id,
          title: mapping.oldId,
          description: "desc",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          properties: {},
          tag_ids: [tag.id],
          collection_ids: [collectionId],
          folder_path: "Old",
          content_revision: 3,
      word_count: 0,
      character_count: 0,
      created_at: timestamp,
          updated_at: timestamp,
        },
        content: `fts body ${mapping.phrase}`,
        sourceRef: {
          plugin_id: "test-plugin",
          external_id: mapping.sourceExternalId,
          synced_at: timestamp,
          metadata: { n: mapping.sourceExternalId },
        },
      });
      await index.upsertMedia({
        id: mapping.mediaId,
        item_id: mapping.oldId,
        filename: `${mapping.mediaId}.png`,
        media_type: "image",
        created_at: timestamp,
      });
      const vector = new Float32Array(EMBEDDING_DIMS);
      vector[0] = 0.25;
      await putItemEmbedding(db, {
        itemId: mapping.oldId,
        modelId: EMBEDDING_MODEL_ID,
        contentRevision: 3,
        inputFingerprint: `fp-${mapping.oldId}`,
        vector,
        updatedAt: timestamp,
      });
    }

    const selectSpy = vi.spyOn(db, "select");
    const executeSpy = vi.spyOn(db, "execute");

    await index.rewriteItemIds(
      mappings.map(({ oldId, newId, folderPath }) => ({
        oldId,
        newId,
        folderPath,
      })),
    );

    const sqlRoundTrips = selectSpy.mock.calls.length + executeSpy.mock.calls.length;
    selectSpy.mockRestore();
    executeSpy.mockRestore();

    // Per-item rewrite is ~15+ round-trips each; batch path stays near O(phases).
    expect(sqlRoundTrips).toBeLessThan(mappings.length * 10);

    const newIds = mappings.map((m) => m.newId).sort();
    expect((await index.listVaultItemIds(meta.id)).sort()).toEqual(newIds);
    expect(await index.listItemIdsByFolderPrefix(meta.id, "Old")).toEqual([]);
    expect(
      (await index.listItemIdsByFolderPrefix(meta.id, "New")).sort(),
    ).toEqual(newIds);
    expect((await index.listItemIdsByTag(meta.id, tag.id)).sort()).toEqual(
      newIds,
    );

    for (const mapping of mappings) {
      const mediaRows = await db.select<{ item_id: string; filename: string }>(
        "SELECT item_id, filename FROM media WHERE id = ?",
        [mapping.mediaId],
      );
      expect(mediaRows).toEqual([
        { item_id: mapping.newId, filename: `${mapping.mediaId}.png` },
      ]);

      const collectionRows = await db.select<{ collection_id: string }>(
        "SELECT collection_id FROM item_collections WHERE item_id = ?",
        [mapping.newId],
      );
      expect(collectionRows).toEqual([{ collection_id: collectionId }]);

      const sourceRows = await db.select<{
        item_id: string;
        plugin_id: string;
        external_id: string;
      }>(
        `SELECT item_id, plugin_id, external_id FROM source_refs
         WHERE item_id = ?`,
        [mapping.newId],
      );
      expect(sourceRows).toEqual([
        {
          item_id: mapping.newId,
          plugin_id: "test-plugin",
          external_id: mapping.sourceExternalId,
        },
      ]);
      const staleSource = await db.select<{ item_id: string }>(
        "SELECT item_id FROM source_refs WHERE item_id = ?",
        [mapping.oldId],
      );
      expect(staleSource).toEqual([]);

      expect(
        await index.searchItemIds(meta.id, mapping.phrase, "all"),
      ).toEqual([mapping.newId]);

      expect(await getItemEmbedding(db, mapping.oldId)).toBeNull();
      const embedding = await getItemEmbedding(db, mapping.newId);
      expect(embedding).not.toBeNull();
      expect(embedding!.inputFingerprint).toBe(`fp-${mapping.oldId}`);
      expect(embedding!.contentRevision).toBe(3);
    }
  });

  it("falls back to per-item rewrite when old/new ids overlap (chain)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-rewrite-overlap-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const index = new SqlVaultIndexStore(db);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const timestamp = new Date().toISOString();

    // Chain A→B, B→C with leaf-first order so per-item path never inserts a live PK.
    const idA = `notes/${createId()}.md`;
    const idB = `notes/${createId()}.md`;
    const idC = `notes/${createId()}.md`;

    for (const id of [idA, idB]) {
      await upsertItem(ctx, path, meta.id, {
        item: {
          id,
          vault_id: meta.id,
          title: id,
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          properties: {},
          tag_ids: [],
          collection_ids: [],
          folder_path: "notes",
          content_revision: 1,
      word_count: 0,
      character_count: 0,
      created_at: timestamp,
          updated_at: timestamp,
        },
        content: `body-${id}`,
      });
    }

    await index.rewriteItemIds([
      { oldId: idB, newId: idC, folderPath: "notes" },
      { oldId: idA, newId: idB, folderPath: "notes" },
    ]);

    expect((await index.listVaultItemIds(meta.id)).sort()).toEqual(
      [idB, idC].sort(),
    );
    expect(await index.listVaultItemIds(meta.id)).not.toContain(idA);
  });

  it("chunks media and source_refs inserts on per-item rewrite (#710)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-rewrite-chunk-children-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const index = new SqlVaultIndexStore(db);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const timestamp = new Date().toISOString();

    // Overlapping chain forces rewriteOneItemId (not the batch multi-item path).
    const idA = `notes/${createId()}.md`;
    const idB = `notes/${createId()}.md`;
    const idC = `notes/${createId()}.md`;

    for (const id of [idA, idB]) {
      await upsertItem(ctx, path, meta.id, {
        item: {
          id,
          vault_id: meta.id,
          title: id,
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          properties: {},
          tag_ids: [],
          collection_ids: [],
          folder_path: "notes",
          content_revision: 1,
          word_count: 0,
          character_count: 0,
          created_at: timestamp,
          updated_at: timestamp,
        },
        content: `body-${id}`,
      });
    }

    const mediaCount = 3;
    const sourceCount = 3;
    const mediaIds: string[] = [];
    for (let i = 0; i < mediaCount; i++) {
      const mediaId = createId();
      mediaIds.push(mediaId);
      await index.upsertMedia({
        id: mediaId,
        item_id: idB,
        filename: `gallery-${i}.png`,
        media_type: "image",
        created_at: timestamp,
      });
    }
    const sourceIds: string[] = [];
    for (let i = 0; i < sourceCount; i++) {
      const sourceId = createId();
      sourceIds.push(sourceId);
      await db.execute(
        `INSERT INTO source_refs (
          id, item_id, plugin_id, external_id, synced_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          sourceId,
          idB,
          "test-plugin",
          `ext-gallery-${i}`,
          timestamp,
          JSON.stringify({ i }),
        ],
      );
    }

    const executeSpy = vi.spyOn(db, "execute");
    await index.rewriteItemIds([
      { oldId: idB, newId: idC, folderPath: "notes" },
      { oldId: idA, newId: idB, folderPath: "notes" },
    ]);

    const mediaInsertSql = executeSpy.mock.calls
      .map(([sql]) => sql)
      .filter(
        (sql): sql is string =>
          typeof sql === "string" &&
          sql.includes("INSERT INTO media") &&
          !sql.includes("ON CONFLICT"),
      );
    const sourceInsertSql = executeSpy.mock.calls
      .map(([sql]) => sql)
      .filter(
        (sql): sql is string =>
          typeof sql === "string" && sql.includes("INSERT INTO source_refs"),
      );
    executeSpy.mockRestore();

    const expectedMediaInserts = Math.ceil(mediaCount / SQL_INSERT_CHUNK);
    const expectedSourceInserts = Math.ceil(sourceCount / SQL_INSERT_CHUNK);
    expect(mediaInsertSql).toHaveLength(expectedMediaInserts);
    expect(sourceInsertSql).toHaveLength(expectedSourceInserts);
    expect(mediaInsertSql[0]).toContain(
      "(?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)",
    );
    expect(sourceInsertSql[0]).toContain(
      "(?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)",
    );

    const mediaRows = await db.select<{ id: string; item_id: string; filename: string }>(
      `SELECT id, item_id, filename FROM media WHERE item_id = ? ORDER BY filename`,
      [idC],
    );
    expect(mediaRows).toEqual(
      mediaIds
        .map((id, i) => ({
          id,
          item_id: idC,
          filename: `gallery-${i}.png`,
        }))
        .sort((a, b) => a.filename.localeCompare(b.filename)),
    );
    expect(
      await db.select<{ id: string }>("SELECT id FROM media WHERE item_id = ?", [
        idB,
      ]),
    ).toEqual([]);

    const sourceRows = await db.select<{
      id: string;
      item_id: string;
      external_id: string;
    }>(
      `SELECT id, item_id, external_id FROM source_refs
       WHERE item_id = ? ORDER BY external_id`,
      [idC],
    );
    expect(sourceRows).toEqual(
      sourceIds
        .map((id, i) => ({
          id,
          item_id: idC,
          external_id: `ext-gallery-${i}`,
        }))
        .sort((a, b) => a.external_id.localeCompare(b.external_id)),
    );
    expect(
      await db.select<{ id: string }>(
        "SELECT id FROM source_refs WHERE item_id = ?",
        [idB],
      ),
    ).toEqual([]);
  });
});

describe("getAdjacentItems", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("returns exact-folder chronological neighbors with id tie-break", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-adjacent-"));
    const db = BetterSqliteMigrator.open(join(dataDir, "collector-adjacent.db"));
    await runMigrations(db);
    const index = new SqlVaultIndexStore(db);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

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
