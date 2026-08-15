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

export async function rewriteItemEmbeddingId(
  db: SqlEmbeddingDb,
  oldId: string,
  newId: string,
): Promise<void> {
  if (oldId === newId) {
    return;
  }
  await rewriteItemEmbeddingIds(db, [{ oldId, newId }]);
}

/** Rebind embedding PKs for many items in shared SELECT/DELETE/INSERT round-trips. */
export async function rewriteItemEmbeddingIds(
  db: SqlEmbeddingDb,
  mappings: Array<{ oldId: string; newId: string }>,
): Promise<void> {
  const active = mappings.filter((mapping) => mapping.oldId !== mapping.newId);
  if (active.length === 0) {
    return;
  }

  const oldIds = active.map((mapping) => mapping.oldId);
  const oldToNew = new Map(
    active.map((mapping) => [mapping.oldId, mapping.newId] as const),
  );
  const placeholders = Array.from({ length: oldIds.length }, () => "?").join(
    ", ",
  );

  const rows = await db.select<EmbeddingSqlRow>(
    `SELECT item_id, model_id, content_revision, input_fingerprint, dims, vector, updated_at
     FROM item_embeddings WHERE item_id IN (${placeholders})`,
    oldIds,
  );
  if (rows.length === 0) {
    return;
  }

  await db.execute(
    `DELETE FROM item_embeddings WHERE item_id IN (${placeholders})`,
    oldIds,
  );

  const EMBEDDING_INSERT_COLUMNS = 7;
  const EMBEDDING_INSERT_CHUNK = Math.min(
    100,
    Math.floor(999 / EMBEDDING_INSERT_COLUMNS),
  );
  const remapped = rows.map((row) => {
    const newId = oldToNew.get(row.item_id);
    if (!newId) {
      throw new Error(
        `rewriteItemEmbeddingIds: missing mapping for ${row.item_id}`,
      );
    }
    const embedding = rowToEmbedding(row);
    if (embedding.vector.length === 0) {
      throw new Error(`empty embedding vector for ${newId}`);
    }
    return {
      itemId: newId,
      modelId: embedding.modelId,
      contentRevision: embedding.contentRevision,
      inputFingerprint: embedding.inputFingerprint,
      vector: embedding.vector,
      updatedAt: embedding.updatedAt,
    };
  });

  for (
    let offset = 0;
    offset < remapped.length;
    offset += EMBEDDING_INSERT_CHUNK
  ) {
    const chunk = remapped.slice(offset, offset + EMBEDDING_INSERT_CHUNK);
    const rowPlaceholders = Array.from(
      { length: chunk.length },
      () => "(?, ?, ?, ?, ?, ?, ?)",
    ).join(", ");
    const binds: unknown[] = [];
    for (const row of chunk) {
      binds.push(
        row.itemId,
        row.modelId,
        row.contentRevision,
        row.inputFingerprint,
        row.vector.length,
        vectorToBlob(row.vector),
        row.updatedAt,
      );
    }
    await db.execute(
      `INSERT INTO item_embeddings (
        item_id, model_id, content_revision, input_fingerprint, dims, vector, updated_at
      ) VALUES ${rowPlaceholders}`,
      binds,
    );
  }
}
