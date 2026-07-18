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
import {
  buildFtsMatchQuery,
  buildMetadataFtsMatchQuery,
} from "../search/fts-query.js";

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
      firstId,
      secondId,
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
        thumbnail: "media/cover.webp",
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
          tag_ids: [],
          collection_ids: [],
          folder_path: "",
          content_revision: 1,
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
    expect(ftsMeta).toEqual([]);

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
      tag_ids: [] as string[],
      collection_ids: [] as string[],
      folder_path: "",
      content_revision: 1,
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
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
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
          tag_ids: tags.map((tag) => tag.id),
          collection_ids: collectionIds,
          folder_path: "",
          content_revision: 1,
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
          tag_ids: [tags[0]!.id],
          collection_ids: [],
          folder_path: "",
          content_revision: 1,
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
      tag_ids: [] as string[],
      collection_ids: [] as string[],
      folder_path: "",
      content_revision: 1,
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
          tag_ids: [],
          collection_ids: [],
          content_revision: 1,
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
