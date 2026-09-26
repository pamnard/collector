import type { SqlExecutor, SqlReader } from "@collector/db";
import { nowIso } from "../util/ids.js";
import { blobToVector, vectorToBlob } from "./vector-blob.js";

type SqlDb = SqlExecutor & SqlReader;

type FolderCentroidSqlRow = {
  folder_path: string;
  model_id: string;
  dims: number;
  item_count: number;
  sum_vector: Uint8Array;
  updated_at: string;
};

export type FolderCentroidRow = {
  folderPath: string;
  modelId: string;
  dims: number;
  itemCount: number;
  /** Mean vector (sum / count). */
  centroid: Float32Array;
  updatedAt: string;
};

function sumBlobToCentroid(
  sumBlob: Uint8Array,
  itemCount: number,
  dims: number,
): Float32Array {
  if (itemCount <= 0) {
    throw new Error("folder centroid item_count must be positive");
  }
  const sum = blobToVector(sumBlob);
  if (sum.length !== dims) {
    throw new Error(
      `folder centroid dims mismatch: row=${dims} blob=${sum.length}`,
    );
  }
  const centroid = new Float32Array(dims);
  for (let i = 0; i < dims; i += 1) {
    centroid[i] = sum[i]! / itemCount;
  }
  return centroid;
}

function rowToCentroid(row: FolderCentroidSqlRow): FolderCentroidRow {
  return {
    folderPath: row.folder_path,
    modelId: row.model_id,
    dims: row.dims,
    itemCount: row.item_count,
    centroid: sumBlobToCentroid(row.sum_vector, row.item_count, row.dims),
    updatedAt: row.updated_at,
  };
}

export async function getFolderCentroid(
  db: SqlReader,
  folderPath: string,
  modelId: string,
): Promise<FolderCentroidRow | null> {
  const rows = await db.select<FolderCentroidSqlRow>(
    `SELECT folder_path, model_id, dims, item_count, sum_vector, updated_at
     FROM folder_centroids
     WHERE folder_path = ? AND model_id = ?`,
    [folderPath, modelId],
  );
  const row = rows[0];
  return row ? rowToCentroid(row) : null;
}

export async function listFolderCentroidsForModel(
  db: SqlReader,
  modelId: string,
): Promise<FolderCentroidRow[]> {
  const rows = await db.select<FolderCentroidSqlRow>(
    `SELECT folder_path, model_id, dims, item_count, sum_vector, updated_at
     FROM folder_centroids
     WHERE model_id = ?`,
    [modelId],
  );
  return rows.map(rowToCentroid);
}

export async function deleteFolderCentroid(
  db: SqlExecutor,
  folderPath: string,
  modelId: string,
): Promise<void> {
  await db.execute(
    `DELETE FROM folder_centroids WHERE folder_path = ? AND model_id = ?`,
    [folderPath, modelId],
  );
}

/**
 * Rebuild one folder's centroid from item_embeddings ⋈ items.
 * Empty / no vectors → delete the centroid row.
 */
export async function rebuildFolderCentroid(
  db: SqlDb,
  folderPath: string,
  modelId: string,
): Promise<void> {
  const rows = await db.select<{ dims: number; vector: Uint8Array }>(
    `SELECT e.dims AS dims, e.vector AS vector
     FROM item_embeddings e
     INNER JOIN items i ON i.id = e.item_id
     WHERE i.folder_path = ? AND e.model_id = ?`,
    [folderPath, modelId],
  );

  if (rows.length === 0) {
    await deleteFolderCentroid(db, folderPath, modelId);
    return;
  }

  const dims = rows[0]!.dims;
  const sum = new Float32Array(dims);
  for (const row of rows) {
    const vector = blobToVector(row.vector);
    if (vector.length !== dims || row.dims !== dims) {
      throw new Error(
        `folder centroid rebuild dims mismatch in ${folderPath}: expected ${dims}`,
      );
    }
    for (let i = 0; i < dims; i += 1) {
      sum[i]! += vector[i]!;
    }
  }

  await db.execute(
    `INSERT INTO folder_centroids (
      folder_path, model_id, dims, item_count, sum_vector, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(folder_path, model_id) DO UPDATE SET
      dims = excluded.dims,
      item_count = excluded.item_count,
      sum_vector = excluded.sum_vector,
      updated_at = excluded.updated_at`,
    [
      folderPath,
      modelId,
      dims,
      rows.length,
      vectorToBlob(sum),
      nowIso(),
    ],
  );
}

/** Drop all centroids for a model, then rebuild every folder that has vectors. */
export async function rebuildAllFolderCentroids(
  db: SqlDb,
  modelId: string,
): Promise<void> {
  await db.execute(`DELETE FROM folder_centroids WHERE model_id = ?`, [
    modelId,
  ]);

  const folders = await db.select<{ folder_path: string }>(
    `SELECT DISTINCT i.folder_path AS folder_path
     FROM items i
     INNER JOIN item_embeddings e ON e.item_id = i.id
     WHERE e.model_id = ?`,
    [modelId],
  );

  for (const row of folders) {
    await rebuildFolderCentroid(db, row.folder_path, modelId);
  }
}

/**
 * Rebuild centroids for the given folder/model pairs (deduped).
 * Used after item delete / embedding refresh for affected folders.
 */
export async function rebuildFolderCentroids(
  db: SqlDb,
  targets: ReadonlyArray<{ folderPath: string; modelId: string }>,
): Promise<void> {
  const seen = new Set<string>();
  for (const target of targets) {
    const key = `${target.modelId}\0${target.folderPath}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    await rebuildFolderCentroid(db, target.folderPath, target.modelId);
  }
}
