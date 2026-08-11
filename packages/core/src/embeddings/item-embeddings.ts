import type { SqlExecutor, SqlReader } from "@collector/db";
import { folderPathAncestorChain } from "@collector/shared";
import type { ItemEmbeddingRefreshInput } from "../adapters/types.js";
import { nowIso } from "../util/ids.js";
import { buildEmbedText } from "./build-embed-text.js";
import { rankByCosine } from "./cosine.js";
import {
  deleteItemEmbedding,
  getItemEmbedding,
  listItemEmbeddingsForModel,
  putItemEmbedding,
} from "./embedding-store.js";
import { fingerprintEmbedText, needsRecompute } from "./invalidation.js";
import type {
  EmbeddingEngine,
  ItemEmbeddingRow,
  SimilarItemHit,
} from "./types.js";

type SqlEmbeddingDb = SqlExecutor & SqlReader;

export type ItemEmbeddingSource = ItemEmbeddingRefreshInput;

async function loadItemFolderPaths(
  db: SqlReader,
  itemIds: string[],
): Promise<Map<string, string>> {
  if (itemIds.length === 0) {
    return new Map();
  }
  const placeholders = itemIds.map(() => "?").join(", ");
  const rows = await db.select<{ id: string; folder_path: string }>(
    `SELECT id, folder_path FROM items WHERE id IN (${placeholders})`,
    itemIds,
  );
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.id, row.folder_path);
  }
  return map;
}

function filterEmbeddingsByFolderChain(
  rows: ItemEmbeddingRow[],
  folderByItemId: Map<string, string>,
  allowedFolders: ReadonlySet<string>,
): ItemEmbeddingRow[] {
  return rows.filter((row) => {
    const folderPath = folderByItemId.get(row.itemId);
    return folderPath !== undefined && allowedFolders.has(folderPath);
  });
}

/**
 * Recompute or clear the embedding for one item.
 * Returns whether a vector row is present afterwards.
 */
export async function recomputeItemEmbedding(
  db: SqlEmbeddingDb,
  engine: EmbeddingEngine,
  source: ItemEmbeddingSource,
): Promise<boolean> {
  const built = buildEmbedText({
    title: source.title,
    description: source.description,
    tagNames: source.tagNames,
    body: source.body ?? undefined,
  });

  if (built === null) {
    await deleteItemEmbedding(db, source.itemId);
    return false;
  }

  const inputFingerprint = fingerprintEmbedText(built.text);
  const stored = await getItemEmbedding(db, source.itemId);
  if (
    !needsRecompute(stored, {
      modelId: engine.modelId,
      contentRevision: source.contentRevision,
      inputFingerprint,
    })
  ) {
    return true;
  }

  const [vector] = await engine.encode([built.text]);
  if (!vector) {
    throw new Error(`embedding engine returned no vector for ${source.itemId}`);
  }
  if (vector.length !== engine.dims) {
    throw new Error(
      `embedding dims mismatch for ${source.itemId}: got ${vector.length}, expected ${engine.dims}`,
    );
  }

  await putItemEmbedding(db, {
    itemId: source.itemId,
    modelId: engine.modelId,
    contentRevision: source.contentRevision,
    inputFingerprint,
    vector,
    updatedAt: nowIso(),
  });
  return true;
}

/**
 * Rank neighbors by cosine within the query item's folder ancestor chain
 * (same folder → parents → root), matching related fallback scope (#603/#414).
 */
export async function findSimilarItemIds(
  db: SqlEmbeddingDb,
  engine: EmbeddingEngine,
  itemId: string,
  limit: number,
): Promise<SimilarItemHit[]> {
  if (limit <= 0) {
    throw new Error("findSimilarItemIds limit must be positive");
  }

  const queryRow = await getItemEmbedding(db, itemId);
  if (queryRow === null || queryRow.modelId !== engine.modelId) {
    return [];
  }

  const queryFolderRows = await db.select<{ folder_path: string }>(
    `SELECT folder_path FROM items WHERE id = ?`,
    [itemId],
  );
  const queryFolder = queryFolderRows[0]?.folder_path;
  if (queryFolder === undefined) {
    return [];
  }
  const allowedFolders = new Set(folderPathAncestorChain(queryFolder));

  const others = (await listItemEmbeddingsForModel(db, engine.modelId)).filter(
    (row) => row.itemId !== itemId,
  );
  const folderByItemId = await loadItemFolderPaths(
    db,
    others.map((row) => row.itemId),
  );
  const candidates = filterEmbeddingsByFolderChain(
    others,
    folderByItemId,
    allowedFolders,
  );

  return rankByCosine(
    queryRow.vector,
    candidates.map((row) => ({ id: row.itemId, vector: row.vector })),
    limit,
  );
}
