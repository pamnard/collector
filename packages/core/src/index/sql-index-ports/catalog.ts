import { loadVaultIdTitleCatalog } from "../../links/vault-id-title-catalog.js";
import type { SqlIndexStoreDb } from "./types.js";

export function createCatalogStorePort(selector: SqlIndexStoreDb) {
  return {
    async listItemIdTitles(
      vaultId: string,
    ): Promise<Array<{ id: string; title: string }>> {
      const rows = await loadVaultIdTitleCatalog(selector, vaultId);
      return rows.map((row) => ({ id: row.id, title: row.title }));
    },

    /** Full on-disk markdown from FTS for text-link inversion (#410). */
    async listItemFtsBodies(
      vaultId: string,
    ): Promise<Array<{ id: string; title: string; content: string }>> {
      const rows = await selector.select<{
        id: string;
        title: string;
        content: string;
      }>(
        `SELECT i.id AS id, i.title AS title, items_fts.content AS content
         FROM items i
         INNER JOIN items_fts ON items_fts.item_id = i.id
         WHERE i.vault_id = ?
           AND i.has_content_file = 1`,
        [vaultId],
      );
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        content: row.content,
      }));
    },

    /** Generation stamp for in-memory backlink reverse map (#410). */
    async vaultItemsContentGeneration(vaultId: string): Promise<number> {
      const rows = await selector.select<{ generation: number | null }>(
        `SELECT MAX(content_revision) AS generation FROM items WHERE vault_id = ?`,
        [vaultId],
      );
      return rows[0]?.generation ?? 0;
    },
  };
}

export type CatalogStorePort = ReturnType<typeof createCatalogStorePort>;
