import { invalidateAllVaultIdTitleCatalogs } from "../../links/vault-id-title-catalog.js";
import { rebuildFolderCentroids } from "../../embeddings/folder-centroid-store.js";
import { sqlInPlaceholders, SQL_INSERT_CHUNK } from "../sql-index-helpers.js";
import type { SqlIndexDb } from "./types.js";

export function createItemsDelete(db: SqlIndexDb) {
  return {
    async deleteItemsBatch(itemIds: string[]): Promise<void> {
      if (itemIds.length === 0) {
        return;
      }

      for (let offset = 0; offset < itemIds.length; offset += SQL_INSERT_CHUNK) {
        const chunk = itemIds.slice(offset, offset + SQL_INSERT_CHUNK);
        const placeholders = sqlInPlaceholders(chunk.length);
        const centroidTargets = await db.select<{
          folder_path: string;
          model_id: string;
        }>(
          `SELECT DISTINCT i.folder_path AS folder_path, e.model_id AS model_id
           FROM items i
           INNER JOIN item_embeddings e ON e.item_id = i.id
           WHERE i.id IN (${placeholders})`,
          chunk,
        );
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
        await rebuildFolderCentroids(
          db,
          centroidTargets.map((row) => ({
            folderPath: row.folder_path,
            modelId: row.model_id,
          })),
        );
      }
      // deleteItem/deleteItemsBatch have no vaultId; clear all catalogs for this SQL session.
      invalidateAllVaultIdTitleCatalogs(db);
    },
  };
}
