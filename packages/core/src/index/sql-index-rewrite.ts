import type { ItemIdRewriteMapping } from "../adapters/types.js";
import {
  rewriteItemEmbeddingId,
  rewriteItemEmbeddingIds,
} from "../embeddings/embedding-store.js";
import {
  INDEX_SYNC_WRITE_BATCH,
  INDEX_SYNC_YIELD_MS,
  yieldToEventLoop,
} from "../util/concurrency.js";
import { mappingsHaveOverlappingIds } from "../util/id-rewrite-mappings.js";
import {
  SQL_INSERT_CHUNK,
  sqlInPlaceholders,
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
  word_count: number;
  character_count: number;
}

const ITEM_INSERT_COLUMNS = 20;

function itemInsertBinds(
  row: ItemRewriteRow,
  newId: string,
  folderPath: string,
): unknown[] {
  return [
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
    row.word_count,
    row.character_count,
  ];
}

/** SQLite bind limit is 999; keep multi-row item inserts under it. */
const ITEM_INSERT_CHUNK = Math.min(
  SQL_INSERT_CHUNK,
  Math.floor(999 / ITEM_INSERT_COLUMNS),
);

function requireMapping(
  oldToMapping: Map<string, ItemIdRewriteMapping>,
  itemId: string,
): ItemIdRewriteMapping {
  const mapping = oldToMapping.get(itemId);
  if (!mapping) {
    throw new Error(`rewriteItemIds: missing mapping for ${itemId}`);
  }
  return mapping;
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
       folder_path, created_at, updated_at, file_mtime_ms, content_revision,
       word_count, character_count
     FROM items
     WHERE id = ?`,
    [oldId],
  );
  if (rows.length === 0) {
    throw new Error(`rewriteItemIds: item not found: ${oldId}`);
  }
  const row = rows[0]!;

  // No multi-statement BEGIN/COMMIT: sqlx pool uses a new connection per execute (#49/#77).
  // Insert new PK → rebind children → delete old row.
  await selector.execute(
    `INSERT INTO items (
      id, vault_id, title, description, url, content_type, source_type, source_id,
      metadata_json, properties_json, thumbnail_path, has_content_file, sort_order,
      folder_path, created_at, updated_at, file_mtime_ms, content_revision,
      word_count, character_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    itemInsertBinds(row, newId, folderPath),
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
    for (let offset = 0; offset < mediaRows.length; offset += SQL_INSERT_CHUNK) {
      const chunk = mediaRows.slice(offset, offset + SQL_INSERT_CHUNK);
      const binds: unknown[] = [];
      for (const media of chunk) {
        binds.push(
          media.id,
          newId,
          media.filename,
          media.media_type,
          media.created_at,
        );
      }
      await selector.execute(
        `INSERT INTO media (id, item_id, filename, media_type, created_at)
         VALUES ${sqlRowPlaceholders(chunk.length, 5)}`,
        binds,
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
    for (
      let offset = 0;
      offset < sourceRows.length;
      offset += SQL_INSERT_CHUNK
    ) {
      const chunk = sourceRows.slice(offset, offset + SQL_INSERT_CHUNK);
      const binds: unknown[] = [];
      for (const source of chunk) {
        binds.push(
          source.id,
          newId,
          source.plugin_id,
          source.external_id,
          source.synced_at,
          source.metadata_json,
        );
      }
      await selector.execute(
        `INSERT INTO source_refs (
          id, item_id, plugin_id, external_id, synced_at, metadata_json
        ) VALUES ${sqlRowPlaceholders(chunk.length, 6)}`,
        binds,
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

  await rewriteItemEmbeddingId(selector, oldId, newId);

  await selector.execute("DELETE FROM items WHERE id = ?", [oldId]);
}

/**
 * Batch PK rewrite for a disjoint id set (folder rename). Same connection
 * constraints as rewriteOneItemId: no multi-statement BEGIN/COMMIT (#49/#77).
 */
async function rewriteItemIdsChunk(
  selector: SqlIndexSelector,
  mappings: ItemIdRewriteMapping[],
): Promise<void> {
  const active = mappings.filter((mapping) => mapping.oldId !== mapping.newId);
  if (active.length === 0) {
    return;
  }

  if (mappingsHaveOverlappingIds(active)) {
    // Batch multi-row INSERT collides when old/new id sets overlap; per-item
    // rewrite avoids that for orderings that never insert an id still present.
    for (const mapping of active) {
      await rewriteOneItemId(selector, mapping);
    }
    return;
  }

  const oldIds = active.map((mapping) => mapping.oldId);
  const oldToMapping = new Map(
    active.map((mapping) => [mapping.oldId, mapping] as const),
  );

  const rows = await selector.select<ItemRewriteRow>(
    `SELECT
       id, vault_id, title, description, url, content_type, source_type,
       source_id, metadata_json, properties_json, thumbnail_path, has_content_file, sort_order,
       folder_path, created_at, updated_at, file_mtime_ms, content_revision,
       word_count, character_count
     FROM items
     WHERE id IN (${sqlInPlaceholders(oldIds.length)})`,
    oldIds,
  );
  if (rows.length !== oldIds.length) {
    const found = new Set(rows.map((row) => row.id));
    const missing = oldIds.find((id) => !found.has(id));
    throw new Error(`rewriteItemIds: item not found: ${missing}`);
  }

  // Insert new PKs → rebind children → delete old rows (no pooled transaction).
  for (let offset = 0; offset < rows.length; offset += ITEM_INSERT_CHUNK) {
    const chunk = rows.slice(offset, offset + ITEM_INSERT_CHUNK);
    const binds: unknown[] = [];
    for (const row of chunk) {
      const mapping = requireMapping(oldToMapping, row.id);
      binds.push(...itemInsertBinds(row, mapping.newId, mapping.folderPath));
    }
    await selector.execute(
      `INSERT INTO items (
        id, vault_id, title, description, url, content_type, source_type, source_id,
        metadata_json, properties_json, thumbnail_path, has_content_file, sort_order,
        folder_path, created_at, updated_at, file_mtime_ms, content_revision,
        word_count, character_count
      ) VALUES ${sqlRowPlaceholders(chunk.length, ITEM_INSERT_COLUMNS)}`,
      binds,
    );
  }

  const tagRows = await selector.select<{ item_id: string; tag_id: string }>(
    `SELECT item_id, tag_id FROM item_tags WHERE item_id IN (${sqlInPlaceholders(oldIds.length)})`,
    oldIds,
  );
  if (tagRows.length > 0) {
    await selector.execute(
      `DELETE FROM item_tags WHERE item_id IN (${sqlInPlaceholders(oldIds.length)})`,
      oldIds,
    );
    for (let offset = 0; offset < tagRows.length; offset += SQL_INSERT_CHUNK) {
      const chunk = tagRows.slice(offset, offset + SQL_INSERT_CHUNK);
      const binds: unknown[] = [];
      for (const tagRow of chunk) {
        const mapping = requireMapping(oldToMapping, tagRow.item_id);
        binds.push(mapping.newId, tagRow.tag_id);
      }
      await selector.execute(
        `INSERT INTO item_tags (item_id, tag_id) VALUES ${sqlRowPlaceholders(chunk.length, 2)}`,
        binds,
      );
    }
  }

  const collectionRows = await selector.select<{
    item_id: string;
    collection_id: string;
  }>(
    `SELECT item_id, collection_id FROM item_collections WHERE item_id IN (${sqlInPlaceholders(oldIds.length)})`,
    oldIds,
  );
  if (collectionRows.length > 0) {
    await selector.execute(
      `DELETE FROM item_collections WHERE item_id IN (${sqlInPlaceholders(oldIds.length)})`,
      oldIds,
    );
    for (
      let offset = 0;
      offset < collectionRows.length;
      offset += SQL_INSERT_CHUNK
    ) {
      const chunk = collectionRows.slice(offset, offset + SQL_INSERT_CHUNK);
      const binds: unknown[] = [];
      for (const collectionRow of chunk) {
        const mapping = requireMapping(oldToMapping, collectionRow.item_id);
        binds.push(mapping.newId, collectionRow.collection_id);
      }
      await selector.execute(
        `INSERT INTO item_collections (item_id, collection_id) VALUES ${sqlRowPlaceholders(chunk.length, 2)}`,
        binds,
      );
    }
  }

  const mediaRows = await selector.select<{
    id: string;
    item_id: string;
    filename: string;
    media_type: string;
    created_at: string;
  }>(
    `SELECT id, item_id, filename, media_type, created_at FROM media
     WHERE item_id IN (${sqlInPlaceholders(oldIds.length)})`,
    oldIds,
  );
  if (mediaRows.length > 0) {
    await selector.execute(
      `DELETE FROM media WHERE item_id IN (${sqlInPlaceholders(oldIds.length)})`,
      oldIds,
    );
    for (let offset = 0; offset < mediaRows.length; offset += SQL_INSERT_CHUNK) {
      const chunk = mediaRows.slice(offset, offset + SQL_INSERT_CHUNK);
      const binds: unknown[] = [];
      for (const media of chunk) {
        const mapping = requireMapping(oldToMapping, media.item_id);
        binds.push(
          media.id,
          mapping.newId,
          media.filename,
          media.media_type,
          media.created_at,
        );
      }
      await selector.execute(
        `INSERT INTO media (id, item_id, filename, media_type, created_at)
         VALUES ${sqlRowPlaceholders(chunk.length, 5)}`,
        binds,
      );
    }
  }

  const sourceRows = await selector.select<{
    id: string;
    item_id: string;
    plugin_id: string;
    external_id: string;
    synced_at: string | null;
    metadata_json: string;
  }>(
    `SELECT id, item_id, plugin_id, external_id, synced_at, metadata_json
     FROM source_refs WHERE item_id IN (${sqlInPlaceholders(oldIds.length)})`,
    oldIds,
  );
  if (sourceRows.length > 0) {
    await selector.execute(
      `DELETE FROM source_refs WHERE item_id IN (${sqlInPlaceholders(oldIds.length)})`,
      oldIds,
    );
    for (
      let offset = 0;
      offset < sourceRows.length;
      offset += SQL_INSERT_CHUNK
    ) {
      const chunk = sourceRows.slice(offset, offset + SQL_INSERT_CHUNK);
      const binds: unknown[] = [];
      for (const source of chunk) {
        const mapping = requireMapping(oldToMapping, source.item_id);
        binds.push(
          source.id,
          mapping.newId,
          source.plugin_id,
          source.external_id,
          source.synced_at,
          source.metadata_json,
        );
      }
      await selector.execute(
        `INSERT INTO source_refs (
          id, item_id, plugin_id, external_id, synced_at, metadata_json
        ) VALUES ${sqlRowPlaceholders(chunk.length, 6)}`,
        binds,
      );
    }
  }

  const ftsRows = await selector.select<{
    item_id: string;
    title: string;
    description: string;
    content: string;
  }>(
    `SELECT item_id, title, description, content FROM items_fts
     WHERE item_id IN (${sqlInPlaceholders(oldIds.length)})`,
    oldIds,
  );
  await selector.execute(
    `DELETE FROM items_fts WHERE item_id IN (${sqlInPlaceholders(oldIds.length)})`,
    oldIds,
  );
  if (ftsRows.length > 0) {
    for (let offset = 0; offset < ftsRows.length; offset += SQL_INSERT_CHUNK) {
      const chunk = ftsRows.slice(offset, offset + SQL_INSERT_CHUNK);
      const binds: unknown[] = [];
      for (const fts of chunk) {
        const mapping = requireMapping(oldToMapping, fts.item_id);
        binds.push(mapping.newId, fts.title, fts.description, fts.content);
      }
      await selector.execute(
        `INSERT INTO items_fts (item_id, title, description, content)
         VALUES ${sqlRowPlaceholders(chunk.length, 4)}`,
        binds,
      );
    }
  }

  await rewriteItemEmbeddingIds(
    selector,
    active.map((mapping) => ({
      oldId: mapping.oldId,
      newId: mapping.newId,
    })),
  );

  await selector.execute(
    `DELETE FROM items WHERE id IN (${sqlInPlaceholders(oldIds.length)})`,
    oldIds,
  );
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
    await rewriteItemIdsChunk(selector, chunk);
    if (offset + chunk.length < mappings.length) {
      await yieldToEventLoop(INDEX_SYNC_YIELD_MS);
    }
  }
}
