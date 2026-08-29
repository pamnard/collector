/**
 * BetterSqlite index write/sync seams (#887): phased metadata/content FTS upserts,
 * frontmatter-only FTS tokens, batch relation binds. Not a MemorySql suite.
 */
import { describe, expect, it } from "vitest";
import {
  buildFtsMatchQuery,
  buildMetadataFtsMatchQuery,
} from "../search/fts-query.js";
import { createId } from "../util/ids.js";
import { upsertItem } from "../vault/item-operations.js";
import { seedTagFromDocumentWritePath } from "../testing/seed-tag.js";
import {
  createSqlIndexTestSuite,
  noteItemFields,
} from "./sql-index-test-harness.js";

describe("upsertItemMetadata / upsertItemContent", () => {
  const suite = createSqlIndexTestSuite();
  suite.registerCleanup();

  it("writes list fields in metadata phase and FTS body in content phase", async () => {
    const { db, index, vault } = await suite.openVaultIndex("collector-phased-upsert-");
    const { meta } = vault;

    const itemId = createId();
    const timestamp = new Date().toISOString();
    const item = noteItemFields(meta.id, itemId, {
      title: "MetaTitle",
      description: "MetaDesc",
      created_at: timestamp,
      updated_at: timestamp,
    });

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
    const { db, index, ctx, vault } = await suite.openVaultIndex("collector-fts-fm-only-");
    const { meta, path } = vault;
    const fmToken = "FmOnlySecretToken534";
    const itemId = `${createId()}.md`;
    const timestamp = new Date().toISOString();
    await upsertItem(ctx, path, meta.id, {
      item: noteItemFields(meta.id, itemId, {
        title: "Body free title",
        description: "plain desc",
        properties: { foreign_key: fmToken },
        created_at: timestamp,
        updated_at: timestamp,
      }),
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
    const { db, index, vault } = await suite.openVaultIndex("collector-fts-fm-flag-");
    const { meta } = vault;
    const itemId = createId();
    const timestamp = new Date().toISOString();
    const item = noteItemFields(meta.id, itemId, {
      title: "MetaTitle",
      description: "MetaDesc",
      created_at: timestamp,
      updated_at: timestamp,
    });
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
    const { db, index, vault } = await suite.openVaultIndex("collector-metadata-fts-search-");
    const { meta } = vault;
    const itemId = createId();
    const timestamp = new Date().toISOString();
    const item = noteItemFields(meta.id, itemId, {
      title: "VisibleTitle",
      description: "VisibleDesc",
      created_at: timestamp,
      updated_at: timestamp,
    });

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
    const { db, index, vault } = await suite.openVaultIndex("collector-metadata-batch-");
    const { meta } = vault;
    const timestamp = new Date().toISOString();
    const records = Array.from({ length: 32 }, () => ({
      item: noteItemFields(meta.id, createId(), {
        title: "Batch item",
        created_at: timestamp,
        updated_at: timestamp,
      }),
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
    const { db, index, ctx, vault } = await suite.openVaultIndex("collector-batch-upsert-");
    const { meta, path } = vault;

    const tagCount = 5;
    const collectionCount = 4;
    const tags = await Promise.all(
      Array.from({ length: tagCount }, (_, i) =>
        seedTagFromDocumentWritePath(ctx, path, meta.id, `tag-${i}`),
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
        item: noteItemFields(meta.id, itemId, {
          title: "Batch",
          tag_ids: tags.map((tag) => tag.id),
          collection_ids: collectionIds,
          created_at: timestamp,
          updated_at: timestamp,
        }),
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
        item: noteItemFields(meta.id, itemId, {
          title: "Batch",
          tag_ids: [tags[0]!.id],
          collection_ids: [],
          created_at: timestamp,
          updated_at: timestamp,
        }),
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
    const { db, index, vault } = await suite.openVaultIndex("collector-upsert-created-at-");
    const { meta } = vault;

    const itemId = createId();
    const firstCreated = "2020-01-01T00:00:00.000Z";
    const secondCreated = "2024-06-15T12:00:00.000Z";
    const updatedAt = "2024-06-15T12:00:00.000Z";
    const base = noteItemFields(meta.id, itemId, {
      title: "Note",
      updated_at: updatedAt,
      created_at: firstCreated,
    });

    await index.upsertItemMetadata({ item: base, fileMtimeMs: 1 }, meta.id);
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
