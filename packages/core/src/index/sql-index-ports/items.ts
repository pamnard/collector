import type {
  IndexedItemMetadata,
  ItemContentUpsert,
} from "../../adapters/types.js";
import { INDEX_SYNC_WRITE_BATCH } from "../../util/concurrency.js";
import {
  invalidateAllVaultIdTitleCatalogs,
  invalidateVaultIdTitleCatalog,
} from "../../links/vault-id-title-catalog.js";
import {
  replaceItemCollections,
  replaceItemTags,
  serializeMetadata,
  serializeProperties,
  sqlCollectionStubPlaceholders,
  sqlInPlaceholders,
  SQL_INSERT_CHUNK,
  sqlRowPlaceholders,
} from "../sql-index-helpers.js";
import type { SqlIndexDb } from "./types.js";

export function createItemsPort(db: SqlIndexDb) {
  return {
    async upsertItemMetadata(
      record: IndexedItemMetadata,
      vaultId: string,
    ): Promise<void> {
      const { item } = record;

      const previous = await db.select<{ vault_id: string }>(
        "SELECT vault_id FROM items WHERE id = ?",
        [item.id],
      );

      // No multi-statement BEGIN/COMMIT across pooled executes (#49/#77).
      await db.execute(
        `INSERT INTO items (
          id, vault_id, title, description, url, content_type, source_type, source_id,
          metadata_json, properties_json, thumbnail_path, has_content_file,
          folder_path, created_at, updated_at, file_mtime_ms, content_revision,
          word_count, character_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          vault_id = excluded.vault_id,
          title = excluded.title,
          description = excluded.description,
          url = excluded.url,
          content_type = excluded.content_type,
          source_type = excluded.source_type,
          source_id = excluded.source_id,
          metadata_json = excluded.metadata_json,
          properties_json = excluded.properties_json,
          thumbnail_path = excluded.thumbnail_path,
          folder_path = excluded.folder_path,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          file_mtime_ms = excluded.file_mtime_ms,
          content_revision = excluded.content_revision,
          word_count = excluded.word_count,
          character_count = excluded.character_count`,
        [
          item.id,
          vaultId,
          item.title,
          item.description,
          item.url ?? null,
          item.content_type,
          item.source_type,
          item.source_id ?? null,
          serializeMetadata(item.metadata),
          serializeProperties(item.properties),
          item.thumbnail ?? null,
          0,
          item.folder_path ?? "",
          item.created_at,
          item.updated_at,
          record.fileMtimeMs ?? null,
          item.content_revision,
          item.word_count,
          item.character_count,
        ],
      );

      await replaceItemTags(db, item.id, item.tag_ids);
      await replaceItemCollections(
        db,
        item.id,
        vaultId,
        item.collection_ids,
        item.created_at,
        item.updated_at,
      );

      // FTS document is written only by upsertItemContent after the content read.
      // ON CONFLICT may change vault_id — invalidate both previous and new vault.
      invalidateVaultIdTitleCatalog(db, vaultId);
      const previousVaultId = previous[0]?.vault_id;
      if (previousVaultId !== undefined && previousVaultId !== vaultId) {
        invalidateVaultIdTitleCatalog(db, previousVaultId);
      }
    },

    async upsertItemMetadataBatch(
      records: IndexedItemMetadata[],
      vaultId: string,
    ): Promise<void> {
      const previousVaultIds = new Set<string>();
      const allItemIds = records.map((record) => record.item.id);
      for (
        let offset = 0;
        offset < allItemIds.length;
        offset += SQL_INSERT_CHUNK
      ) {
        const idChunk = allItemIds.slice(offset, offset + SQL_INSERT_CHUNK);
        if (idChunk.length === 0) {
          continue;
        }
        const previousRows = await db.select<{ vault_id: string }>(
          `SELECT vault_id FROM items WHERE id IN (${sqlInPlaceholders(idChunk.length)})`,
          idChunk,
        );
        for (const row of previousRows) {
          if (row.vault_id !== vaultId) {
            previousVaultIds.add(row.vault_id);
          }
        }
      }

      for (
        let offset = 0;
        offset < records.length;
        offset += INDEX_SYNC_WRITE_BATCH
      ) {
        const chunk = records.slice(offset, offset + INDEX_SYNC_WRITE_BATCH);
        const itemBinds: unknown[] = [];
        const itemIds: string[] = [];
        const tagLinks: Array<{ itemId: string; tagId: string }> = [];
        const collectionLinks: Array<{
          itemId: string;
          collectionId: string;
          createdAt: string;
          updatedAt: string;
        }> = [];

        for (const record of chunk) {
          const { item } = record;
          itemIds.push(item.id);
          itemBinds.push(
            item.id,
            vaultId,
            item.title,
            item.description,
            item.url ?? null,
            item.content_type,
            item.source_type,
            item.source_id ?? null,
            serializeMetadata(item.metadata),
            serializeProperties(item.properties),
            item.thumbnail ?? null,
            0,
            item.folder_path ?? "",
            item.created_at,
            item.updated_at,
            record.fileMtimeMs ?? null,
            item.content_revision,
            item.word_count,
            item.character_count,
          );
          for (const tagId of item.tag_ids) {
            tagLinks.push({ itemId: item.id, tagId });
          }
          for (const collectionId of item.collection_ids) {
            collectionLinks.push({
              itemId: item.id,
              collectionId,
              createdAt: item.created_at,
              updatedAt: item.updated_at,
            });
          }
        }

        await db.execute(
          `INSERT INTO items (
            id, vault_id, title, description, url, content_type, source_type, source_id,
            metadata_json, properties_json, thumbnail_path, has_content_file,
            folder_path, created_at, updated_at, file_mtime_ms, content_revision,
            word_count, character_count
          ) VALUES ${sqlRowPlaceholders(chunk.length, 19)}
          ON CONFLICT(id) DO UPDATE SET
            vault_id = excluded.vault_id,
            title = excluded.title,
            description = excluded.description,
            url = excluded.url,
            content_type = excluded.content_type,
            source_type = excluded.source_type,
            source_id = excluded.source_id,
            metadata_json = excluded.metadata_json,
            properties_json = excluded.properties_json,
            thumbnail_path = excluded.thumbnail_path,
            folder_path = excluded.folder_path,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            file_mtime_ms = excluded.file_mtime_ms,
            content_revision = excluded.content_revision,
            word_count = excluded.word_count,
            character_count = excluded.character_count`,
          itemBinds,
        );

        await db.execute(
          `DELETE FROM item_tags WHERE item_id IN (${sqlInPlaceholders(itemIds.length)})`,
          itemIds,
        );
        for (
          let linkOffset = 0;
          linkOffset < tagLinks.length;
          linkOffset += SQL_INSERT_CHUNK
        ) {
          const links = tagLinks.slice(linkOffset, linkOffset + SQL_INSERT_CHUNK);
          await db.execute(
            `INSERT INTO item_tags (item_id, tag_id) VALUES ${sqlRowPlaceholders(links.length, 2)}`,
            links.flatMap((link) => [link.itemId, link.tagId]),
          );
        }

        await db.execute(
          `DELETE FROM item_collections WHERE item_id IN (${sqlInPlaceholders(itemIds.length)})`,
          itemIds,
        );
        for (
          let linkOffset = 0;
          linkOffset < collectionLinks.length;
          linkOffset += SQL_INSERT_CHUNK
        ) {
          const links = collectionLinks.slice(
            linkOffset,
            linkOffset + SQL_INSERT_CHUNK,
          );
          await db.execute(
            `INSERT INTO collections (
              id, vault_id, parent_id, name, description, created_at, updated_at
            ) VALUES ${sqlCollectionStubPlaceholders(links.length)}
            ON CONFLICT(id) DO NOTHING`,
            links.flatMap((link) => [
              link.collectionId,
              vaultId,
              link.collectionId,
              link.createdAt,
              link.updatedAt,
            ]),
          );
          await db.execute(
            `INSERT INTO item_collections (item_id, collection_id)
             VALUES ${sqlRowPlaceholders(links.length, 2)}`,
            links.flatMap((link) => [link.itemId, link.collectionId]),
          );
        }
      }
      invalidateVaultIdTitleCatalog(db, vaultId);
      for (const previousVaultId of previousVaultIds) {
        invalidateVaultIdTitleCatalog(db, previousVaultId);
      }
    },

    async upsertItemContent(input: ItemContentUpsert): Promise<void> {
      const { itemId, title, description, content, hasContentFile, sourceRef } =
        input;

      await db.execute(
        "UPDATE items SET has_content_file = ? WHERE id = ?",
        [hasContentFile ? 1 : 0, itemId],
      );

      await db.execute("DELETE FROM items_fts WHERE item_id = ?", [itemId]);
      await db.execute(
        "INSERT INTO items_fts (item_id, title, description, content) VALUES (?, ?, ?, ?)",
        [itemId, title, description, content ?? ""],
      );

      if (sourceRef) {
        await db.execute("DELETE FROM source_refs WHERE item_id = ?", [
          itemId,
        ]);
        await db.execute(
          "DELETE FROM source_refs WHERE plugin_id = ? AND external_id = ?",
          [sourceRef.plugin_id, sourceRef.external_id],
        );
        await db.execute(
          `INSERT INTO source_refs (
            id, item_id, plugin_id, external_id, synced_at, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(),
            itemId,
            sourceRef.plugin_id,
            sourceRef.external_id,
            sourceRef.synced_at ?? null,
            serializeMetadata(sourceRef.metadata ?? {}),
          ],
        );
      }
    },

    async upsertItemContentBatch(inputs: ItemContentUpsert[]): Promise<void> {
      for (
        let offset = 0;
        offset < inputs.length;
        offset += INDEX_SYNC_WRITE_BATCH
      ) {
        const chunk = inputs.slice(offset, offset + INDEX_SYNC_WRITE_BATCH);
        const itemIds = chunk.map((input) => input.itemId);
        const hasContentBinds: unknown[] = [];
        for (const input of chunk) {
          hasContentBinds.push(input.itemId, input.hasContentFile ? 1 : 0);
        }
        await db.execute(
          `UPDATE items
           SET has_content_file = CASE id ${chunk.map(() => "WHEN ? THEN ?").join(" ")} END
           WHERE id IN (${sqlInPlaceholders(itemIds.length)})`,
          [...hasContentBinds, ...itemIds],
        );

        await db.execute(
          `DELETE FROM items_fts WHERE item_id IN (${sqlInPlaceholders(itemIds.length)})`,
          itemIds,
        );
        await db.execute(
          `INSERT INTO items_fts (item_id, title, description, content)
           VALUES ${sqlRowPlaceholders(chunk.length, 4)}`,
          chunk.flatMap((input) => [
            input.itemId,
            input.title,
            input.description,
            input.content ?? "",
          ]),
        );

        const inputsWithSourceRefs = chunk.filter(
          (
            input,
          ): input is ItemContentUpsert & {
            sourceRef: NonNullable<ItemContentUpsert["sourceRef"]>;
          } => input.sourceRef !== null,
        );
        if (inputsWithSourceRefs.length === 0) {
          continue;
        }

        await db.execute(
          `DELETE FROM source_refs WHERE item_id IN (${sqlInPlaceholders(inputsWithSourceRefs.length)})`,
          inputsWithSourceRefs.map((input) => input.itemId),
        );
        await db.execute(
          `DELETE FROM source_refs
           WHERE (plugin_id, external_id) IN (${sqlRowPlaceholders(inputsWithSourceRefs.length, 2)})`,
          inputsWithSourceRefs.flatMap((input) => [
            input.sourceRef.plugin_id,
            input.sourceRef.external_id,
          ]),
        );

        const latestByExternalRef = new Map<
          string,
          (typeof inputsWithSourceRefs)[number]
        >();
        for (const input of inputsWithSourceRefs) {
          latestByExternalRef.set(
            `${input.sourceRef.plugin_id}\u0000${input.sourceRef.external_id}`,
            input,
          );
        }
        const sourceRefInputs = [...latestByExternalRef.values()];
        await db.execute(
          `INSERT INTO source_refs (
            id, item_id, plugin_id, external_id, synced_at, metadata_json
          ) VALUES ${sqlRowPlaceholders(sourceRefInputs.length, 6)}`,
          sourceRefInputs.flatMap((input) => [
            crypto.randomUUID(),
            input.itemId,
            input.sourceRef.plugin_id,
            input.sourceRef.external_id,
            input.sourceRef.synced_at ?? null,
            serializeMetadata(input.sourceRef.metadata ?? {}),
          ]),
        );
      }
    },

    async deleteItemsBatch(itemIds: string[]): Promise<void> {
      if (itemIds.length === 0) {
        return;
      }

      for (let offset = 0; offset < itemIds.length; offset += SQL_INSERT_CHUNK) {
        const chunk = itemIds.slice(offset, offset + SQL_INSERT_CHUNK);
        const placeholders = sqlInPlaceholders(chunk.length);
        await db.execute(
          `DELETE FROM media WHERE item_id IN (${placeholders})`,
          chunk,
        );
        await db.execute(
          `DELETE FROM source_refs WHERE item_id IN (${placeholders})`,
          chunk,
        );
        await db.execute(
          `DELETE FROM items_fts WHERE item_id IN (${placeholders})`,
          chunk,
        );
        await db.execute(
          `DELETE FROM item_embeddings WHERE item_id IN (${placeholders})`,
          chunk,
        );
        await db.execute(
          `DELETE FROM items WHERE id IN (${placeholders})`,
          chunk,
        );
      }
      // deleteItem/deleteItemsBatch have no vaultId; clear all catalogs for this SQL session.
      invalidateAllVaultIdTitleCatalogs(db);
    },
  };
}

export type ItemsPort = ReturnType<typeof createItemsPort>;
