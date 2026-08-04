import type { ItemIdRewriteMapping } from "../adapters/types.js";
import {
  INDEX_SYNC_WRITE_BATCH,
  INDEX_SYNC_YIELD_MS,
  yieldToEventLoop,
} from "../util/concurrency.js";
import {
  SQL_INSERT_CHUNK,
  sqlRowPlaceholders,
  type SqlIndexSelector,
} from "./sql-index-helpers.js";

interface ItemRewriteRow {
  id: string;
  vault_id: string;
  title: string;
  description: string;
  url: string | null;
  content_type: string;
  source_type: string;
  source_id: string | null;
  metadata_json: string;
  properties_json: string;
  thumbnail_path: string | null;
  has_content_file: number;
  sort_order: number;
  folder_path: string;
  created_at: string;
  updated_at: string;
  file_mtime_ms: number | null;
  content_revision: number;
}

export async function rewriteOneItemId(
  selector: SqlIndexSelector,
  mapping: ItemIdRewriteMapping,
): Promise<void> {
  const { oldId, newId, folderPath } = mapping;
  if (oldId === newId) {
    return;
  }

  const rows = await selector.select<ItemRewriteRow>(
    `SELECT
       id, vault_id, title, description, url, content_type, source_type,
       source_id, metadata_json, properties_json, thumbnail_path, has_content_file, sort_order,
       folder_path, created_at, updated_at, file_mtime_ms, content_revision
     FROM items
     WHERE id = ?`,
    [oldId],
  );
  if (rows.length === 0) {
    throw new Error(`rewriteItemIds: item not found: ${oldId}`);
  }
  const row = rows[0]!;

  // No multi-IPC BEGIN/COMMIT: sqlx pool uses a new connection per execute (#49/#77).
  // Insert new PK → rebind children → delete old row.
  await selector.execute(
    `INSERT INTO items (
      id, vault_id, title, description, url, content_type, source_type, source_id,
      metadata_json, properties_json, thumbnail_path, has_content_file, sort_order,
      folder_path, created_at, updated_at, file_mtime_ms, content_revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId,
      row.vault_id,
      row.title,
      row.description,
      row.url,
      row.content_type,
      row.source_type,
      row.source_id,
      row.metadata_json,
      row.properties_json,
      row.thumbnail_path,
      row.has_content_file,
      row.sort_order,
      folderPath,
      row.created_at,
      row.updated_at,
      row.file_mtime_ms,
      row.content_revision,
    ],
  );

  const tagRows = await selector.select<{ tag_id: string }>(
    "SELECT tag_id FROM item_tags WHERE item_id = ?",
    [oldId],
  );
  if (tagRows.length > 0) {
    await selector.execute("DELETE FROM item_tags WHERE item_id = ?", [
      oldId,
    ]);
    for (let offset = 0; offset < tagRows.length; offset += SQL_INSERT_CHUNK) {
      const chunk = tagRows.slice(offset, offset + SQL_INSERT_CHUNK);
      const binds: unknown[] = [];
      for (const tagRow of chunk) {
        binds.push(newId, tagRow.tag_id);
      }
      await selector.execute(
        `INSERT INTO item_tags (item_id, tag_id) VALUES ${sqlRowPlaceholders(chunk.length, 2)}`,
        binds,
      );
    }
  }

  const collectionRows = await selector.select<{
    collection_id: string;
  }>("SELECT collection_id FROM item_collections WHERE item_id = ?", [
    oldId,
  ]);
  if (collectionRows.length > 0) {
    await selector.execute(
      "DELETE FROM item_collections WHERE item_id = ?",
      [oldId],
    );
    for (
      let offset = 0;
      offset < collectionRows.length;
      offset += SQL_INSERT_CHUNK
    ) {
      const chunk = collectionRows.slice(offset, offset + SQL_INSERT_CHUNK);
      const binds: unknown[] = [];
      for (const collectionRow of chunk) {
        binds.push(newId, collectionRow.collection_id);
      }
      await selector.execute(
        `INSERT INTO item_collections (item_id, collection_id) VALUES ${sqlRowPlaceholders(chunk.length, 2)}`,
        binds,
      );
    }
  }

  const mediaRows = await selector.select<{
    id: string;
    filename: string;
    media_type: string;
    created_at: string;
  }>(
    "SELECT id, filename, media_type, created_at FROM media WHERE item_id = ?",
    [oldId],
  );
  if (mediaRows.length > 0) {
    await selector.execute("DELETE FROM media WHERE item_id = ?", [
      oldId,
    ]);
    for (const media of mediaRows) {
      await selector.execute(
        `INSERT INTO media (id, item_id, filename, media_type, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          media.id,
          newId,
          media.filename,
          media.media_type,
          media.created_at,
        ],
      );
    }
  }

  const sourceRows = await selector.select<{
    id: string;
    plugin_id: string;
    external_id: string;
    synced_at: string | null;
    metadata_json: string;
  }>(
    `SELECT id, plugin_id, external_id, synced_at, metadata_json
     FROM source_refs WHERE item_id = ?`,
    [oldId],
  );
  if (sourceRows.length > 0) {
    await selector.execute("DELETE FROM source_refs WHERE item_id = ?", [
      oldId,
    ]);
    for (const source of sourceRows) {
      await selector.execute(
        `INSERT INTO source_refs (
          id, item_id, plugin_id, external_id, synced_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          source.id,
          newId,
          source.plugin_id,
          source.external_id,
          source.synced_at,
          source.metadata_json,
        ],
      );
    }
  }

  const ftsRows = await selector.select<{
    title: string;
    description: string;
    content: string;
  }>(
    "SELECT title, description, content FROM items_fts WHERE item_id = ?",
    [oldId],
  );
  await selector.execute("DELETE FROM items_fts WHERE item_id = ?", [
    oldId,
  ]);
  if (ftsRows.length > 0) {
    const fts = ftsRows[0]!;
    await selector.execute(
      "INSERT INTO items_fts (item_id, title, description, content) VALUES (?, ?, ?, ?)",
      [newId, fts.title, fts.description, fts.content],
    );
  }

  await selector.execute("DELETE FROM items WHERE id = ?", [oldId]);
}

export async function rewriteItemIds(
  selector: SqlIndexSelector,
  mappings: ItemIdRewriteMapping[],
): Promise<void> {
  if (mappings.length === 0) {
    return;
  }

  for (let offset = 0; offset < mappings.length; offset += INDEX_SYNC_WRITE_BATCH) {
    const chunk = mappings.slice(offset, offset + INDEX_SYNC_WRITE_BATCH);
    for (const mapping of chunk) {
      await rewriteOneItemId(selector, mapping);
    }
    if (offset + chunk.length < mappings.length) {
      await yieldToEventLoop(INDEX_SYNC_YIELD_MS);
    }
  }
}
