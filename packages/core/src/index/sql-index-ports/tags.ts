import type { Tag } from "@collector/shared";
import type { SqlIndexDb, SqlIndexStoreDb } from "./types.js";

export function createTagsPort(db: SqlIndexDb) {
  return {
    async upsertTag(tag: Tag, vaultId: string): Promise<void> {
      await db.execute(
        `INSERT INTO tags (id, vault_id, name, color, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           color = excluded.color`,
        [tag.id, vaultId, tag.name, tag.color ?? null, tag.created_at],
      );
    },

    async deleteTag(tagId: string): Promise<void> {
      await db.execute("DELETE FROM item_tags WHERE tag_id = ?", [tagId]);
      await db.execute("DELETE FROM tags WHERE id = ?", [tagId]);
    },
  };
}

export type TagsPort = ReturnType<typeof createTagsPort>;

/**
 * Store upsert: disk may recreate a tag id for an existing name; prefer the
 * disk id and drop the stale index row so UNIQUE(vault_id, name) does not fail.
 */
export async function upsertTagPreferringDiskId(
  selector: SqlIndexStoreDb,
  tag: Tag,
  vaultId: string,
  baseUpsert: (tag: Tag, vaultId: string) => Promise<void>,
): Promise<void> {
  const stale = await selector.select<{ id: string }>(
    `SELECT id FROM tags WHERE vault_id = ? AND name = ? AND id != ?`,
    [vaultId, tag.name, tag.id],
  );
  for (const row of stale) {
    await selector.execute(
      `INSERT OR IGNORE INTO item_tags (item_id, tag_id)
       SELECT item_id, ? FROM item_tags WHERE tag_id = ?`,
      [tag.id, row.id],
    );
    await selector.execute(`DELETE FROM item_tags WHERE tag_id = ?`, [row.id]);
    await selector.execute(`DELETE FROM tags WHERE id = ?`, [row.id]);
  }

  await baseUpsert(tag, vaultId);
}
