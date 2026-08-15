import type { SqlExecutor, SqlReader } from "@collector/db";
import type { ItemEmbeddingPut, ItemEmbeddingRow } from "./types.js";
import { blobToVector, vectorToBlob } from "./vector-blob.js";

type SqlEmbeddingDb = SqlExecutor & SqlReader;

type EmbeddingSqlRow = {
  item_id: string;
  model_id: string;
  content_revision: number;
  input_fingerprint: string;
  dims: number;
  vector: Buffer | Uint8Array;
  updated_at: string;
};

function rowToEmbedding(row: EmbeddingSqlRow): ItemEmbeddingRow {
  const vector = blobToVector(row.vector);
  if (vector.length !== row.dims) {
    throw new Error(
      `item embedding dims mismatch for ${row.item_id}: row=${row.dims} blob=${vector.length}`,
    );
  }
  return {
    itemId: row.item_id,
    modelId: row.model_id,
    contentRevision: row.content_revision,
    inputFingerprint: row.input_fingerprint,
    dims: row.dims,
    vector,
    updatedAt: row.updated_at,
  };
}

export async function putItemEmbedding(
  db: SqlExecutor,
  row: ItemEmbeddingPut,
): Promise<void> {
  if (row.vector.length === 0) {
    throw new Error(`empty embedding vector for ${row.itemId}`);
  }
  await db.execute(
    `INSERT INTO item_embeddings (
      item_id, model_id, content_revision, input_fingerprint, dims, vector, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(item_id) DO UPDATE SET
      model_id = excluded.model_id,
      content_revision = excluded.content_revision,
      input_fingerprint = excluded.input_fingerprint,
      dims = excluded.dims,
      vector = excluded.vector,
      updated_at = excluded.updated_at`,
    [
      row.itemId,
      row.modelId,
      row.contentRevision,
      row.inputFingerprint,
      row.vector.length,
      vectorToBlob(row.vector),
      row.updatedAt,
    ],
  );
}

export async function getItemEmbedding(
  db: SqlReader,
  itemId: string,
): Promise<ItemEmbeddingRow | null> {
  const rows = await db.select<EmbeddingSqlRow>(
    `SELECT item_id, model_id, content_revision, input_fingerprint, dims, vector, updated_at
     FROM item_embeddings WHERE item_id = ?`,
    [itemId],
  );
  const row = rows[0];
  return row ? rowToEmbedding(row) : null;
}

export async function deleteItemEmbedding(
  db: SqlExecutor,
  itemId: string,
): Promise<void> {
  await db.execute("DELETE FROM item_embeddings WHERE item_id = ?", [itemId]);
}

export async function listItemEmbeddingsForModel(
  db: SqlReader,
  modelId: string,
): Promise<ItemEmbeddingRow[]> {
  const rows = await db.select<EmbeddingSqlRow>(
    `SELECT item_id, model_id, content_revision, input_fingerprint, dims, vector, updated_at
     FROM item_embeddings WHERE model_id = ?`,
    [modelId],
  );
  return rows.map(rowToEmbedding);
}

/**
 * Load embeddings for a model whose items sit in one of `folderPaths`
 * (typically a folder ancestor chain). Excludes `excludeItemId`.
 */
export async function listItemEmbeddingsForModelInFolders(
  db: SqlReader,
  modelId: string,
  folderPaths: readonly string[],
  excludeItemId: string,
): Promise<ItemEmbeddingRow[]> {
  if (folderPaths.length === 0) {
    throw new Error(
      "listItemEmbeddingsForModelInFolders folderPaths must be non-empty",
    );
  }
  const folderPlaceholders = folderPaths.map(() => "?").join(", ");
  const rows = await db.select<EmbeddingSqlRow>(
    `SELECT e.item_id, e.model_id, e.content_revision, e.input_fingerprint,
            e.dims, e.vector, e.updated_at
     FROM item_embeddings e
     INNER JOIN items i ON i.id = e.item_id
     WHERE e.model_id = ?
       AND e.item_id != ?
       AND i.folder_path IN (${folderPlaceholders})`,
    [modelId, excludeItemId, ...folderPaths],
  );
  return rows.map(rowToEmbedding);
}

export async function rewriteItemEmbeddingId(
  db: SqlEmbeddingDb,
  oldId: string,
  newId: string,
): Promise<void> {
  const existing = await getItemEmbedding(db, oldId);
  if (!existing) {
    return;
  }
  await deleteItemEmbedding(db, oldId);
  await putItemEmbedding(db, {
    itemId: newId,
    modelId: existing.modelId,
    contentRevision: existing.contentRevision,
    inputFingerprint: existing.inputFingerprint,
    vector: existing.vector,
    updatedAt: existing.updatedAt,
  });
}
