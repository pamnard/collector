import type { ItemContentUpsert } from "../../adapters/types.js";
import { INDEX_SYNC_WRITE_BATCH } from "../../util/concurrency.js";
import {
  serializeMetadata,
  sqlInPlaceholders,
  sqlRowPlaceholders,
} from "../sql-index-helpers.js";
import type { SqlIndexDb } from "./types.js";

export function createItemsUpsertContent(db: SqlIndexDb) {
  return {
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
  };
}
