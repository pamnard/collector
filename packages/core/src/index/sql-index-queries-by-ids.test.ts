import { describe, expect, it } from "vitest";
import { createId } from "../util/ids.js";
import { upsertItem } from "../vault/item-operations.js";
import { createTag } from "../vault/tag-operations.js";
import { createSqlIndexTestSuite } from "./sql-index-test-harness.js";

describe("listItemPresentationStampsByIds", () => {
  const suite = createSqlIndexTestSuite();
  suite.registerCleanup();

  it("returns file_mtime_ms stamps in id order and fails on missing mtime", async () => {
    const { index, ctx, vault } = await suite.openVaultIndex("collector-presentation-stamps-");
    const { meta, path } = vault;
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
  const suite = createSqlIndexTestSuite();
  suite.registerCleanup();

  it("returns ItemFile DTOs with tag_ids and collection_ids from SQL", async () => {
    const { fs, index, ctx, vault } = await suite.openVaultIndex("collector-list-item-files-");
    const { meta, path } = vault;

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
    const { db, index, ctx, vault } = await suite.openVaultIndex("collector-list-corrupt-meta-");
    const { meta, path } = vault;
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
    const { db, index, vault } = await suite.openVaultIndex("collector-list-chunk-order-");
    const { meta } = vault;
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
    const { db, index, vault } = await suite.openVaultIndex("collector-list-bind-safe-");
    const { meta } = vault;
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
    const { index, vault } = await suite.openVaultIndex("collector-list-absurd-");
    const { meta } = vault;
    const ids = Array.from({ length: SQL_IN_LIST_MAX + 1 }, (_, i) => `${i}.md`);
    await expect(index.listItemFilesByIds(meta.id, ids)).rejects.toThrow(
      /exceeds max/,
    );
  });
});

describe("listItemSyncMetaByIds", () => {
  const suite = createSqlIndexTestSuite();
  suite.registerCleanup();

  it("returns only requested ids and empty for empty input", async () => {
    const { index, ctx, vault } = await suite.openVaultIndex("collector-sync-meta-by-ids-");
    const { meta, path } = vault;
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
