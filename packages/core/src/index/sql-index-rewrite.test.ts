import { describe, expect, it, vi } from "vitest";
import {
  EMBEDDING_DIMS,
  EMBEDDING_MODEL_ID,
} from "../embeddings/constants.js";
import {
  getItemEmbedding,
  putItemEmbedding,
} from "../embeddings/embedding-store.js";
import { createId } from "../util/ids.js";
import { upsertItem } from "../vault/item-operations.js";
import { createTag } from "../vault/tag-operations.js";
import {
  SQL_INSERT_CHUNK,
  sqlRowPlaceholders,
} from "./sql-index-helpers.js";
import {
  createSqlIndexTestSuite,
  noteItemFields,
} from "./sql-index-test-harness.js";

describe("rewriteItemIds", () => {
  const suite = createSqlIndexTestSuite();
  suite.registerCleanup();

  it("rewrites item PK and preserves tags, media, and FTS body", async () => {
    const { db, index, ctx, vault } = await suite.openVaultIndex("collector-rewrite-ids-");
    const { meta, path } = vault;
    const tag = await createTag(ctx, path, meta.id, { name: "keep" });

    const oldId = `Old/${createId()}.md`;
    const newId = oldId.replace("Old/", "New/");
    const timestamp = new Date().toISOString();
    const mediaId = createId();

    await upsertItem(ctx, path, meta.id, {
      item: noteItemFields(meta.id, oldId, {
        title: "Rewrite me",
        description: "desc",
        metadata: { k: 1 },
        tag_ids: [tag.id],
        folder_path: "Old",
        content_revision: 2,
        created_at: timestamp,
        updated_at: timestamp,
      }),
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
    const { db, index, ctx, vault } = await suite.openVaultIndex("collector-rewrite-batch-");
    const { meta, path } = vault;
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
        item: noteItemFields(meta.id, mapping.oldId, {
          description: "desc",
          tag_ids: [tag.id],
          collection_ids: [collectionId],
          folder_path: "Old",
          content_revision: 3,
          created_at: timestamp,
          updated_at: timestamp,
        }),
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
    const { index, ctx, vault } = await suite.openVaultIndex("collector-rewrite-overlap-");
    const { meta, path } = vault;
    const timestamp = new Date().toISOString();

    // Chain A→B, B→C with leaf-first order so per-item path never inserts a live PK.
    const idA = `notes/${createId()}.md`;
    const idB = `notes/${createId()}.md`;
    const idC = `notes/${createId()}.md`;

    for (const id of [idA, idB]) {
      await upsertItem(ctx, path, meta.id, {
        item: noteItemFields(meta.id, id, {
          folder_path: "notes",
          created_at: timestamp,
          updated_at: timestamp,
        }),
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
    const { db, index, ctx, vault } = await suite.openVaultIndex(
      "collector-rewrite-chunk-children-",
    );
    const { meta, path } = vault;
    const timestamp = new Date().toISOString();

    // Overlapping chain forces rewriteOneItemId (not the batch multi-item path).
    const idA = `notes/${createId()}.md`;
    const idB = `notes/${createId()}.md`;
    const idC = `notes/${createId()}.md`;

    for (const id of [idA, idB]) {
      await upsertItem(ctx, path, meta.id, {
        item: noteItemFields(meta.id, id, {
          folder_path: "notes",
          created_at: timestamp,
          updated_at: timestamp,
        }),
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
    expect(mediaInsertSql[0]).toContain(sqlRowPlaceholders(mediaCount, 5));
    expect(sourceInsertSql[0]).toContain(sqlRowPlaceholders(sourceCount, 6));

    const mediaRows = await db.select<{
      id: string;
      item_id: string;
      filename: string;
    }>(
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
