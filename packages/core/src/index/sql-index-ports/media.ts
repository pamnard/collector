import type { MediaFileMeta } from "@collector/shared";
import type { SqlIndexDb } from "./types.js";

export function createMediaPort(db: SqlIndexDb) {
  return {
    async upsertMedia(media: MediaFileMeta): Promise<void> {
      await db.execute(
        `INSERT INTO media (id, item_id, filename, media_type, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           item_id = excluded.item_id,
           filename = excluded.filename,
           media_type = excluded.media_type,
           created_at = excluded.created_at`,
        [
          media.id,
          media.item_id,
          media.filename,
          media.media_type,
          media.created_at,
        ],
      );
    },

    async deleteMedia(mediaId: string): Promise<void> {
      await db.execute("DELETE FROM media WHERE id = ?", [mediaId]);
    },

    async deleteMediaForItem(itemId: string): Promise<void> {
      await db.execute("DELETE FROM media WHERE item_id = ?", [itemId]);
    },
  };
}

export type MediaPort = ReturnType<typeof createMediaPort>;
