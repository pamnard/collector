import type { SqlExecutor, SqlReader } from "@collector/db";
import {
  folderPathAncestorChain,
  isInboxFolderName,
} from "@collector/shared";
import type { ItemEmbeddingRefreshInput } from "../adapters/types.js";
import { nowIso } from "../util/ids.js";
import { buildEmbedText } from "./build-embed-text.js";
import { cosineSimilarity, rankByCosine } from "./cosine.js";
import {
  deleteItemEmbedding,
  getItemEmbedding,
  listItemEmbeddingsForModelInFolders,
  putItemEmbedding,
} from "./embedding-store.js";
import {
  listFolderCentroidsForModel,
  rebuildFolderCentroid,
} from "./folder-centroid-store.js";
import {
  cosineToUnitInterval,
  folderPathNameTokens,
  hybridFolderMoveScore,
  itemSignalNameTokens,
  tokenSetOverlap,
} from "./folder-move-score.js";
import { fingerprintEmbedText, needsRecompute } from "./invalidation.js";
import type {
  EmbeddingEngine,
  FolderMoveSuggestion,
  SimilarItemHit,
} from "./types.js";

type SqlEmbeddingDb = SqlExecutor & SqlReader;

export type ItemEmbeddingSource = ItemEmbeddingRefreshInput;

async function itemFolderPath(
  db: SqlReader,
  itemId: string,
): Promise<string | null> {
  const rows = await db.select<{ folder_path: string }>(
    `SELECT folder_path FROM items WHERE id = ?`,
    [itemId],
  );
  return rows[0]?.folder_path ?? null;
}

async function rebuildCentroidsForItemFolder(
  db: SqlEmbeddingDb,
  folderPath: string | null,
  modelIds: Iterable<string>,
): Promise<void> {
  if (folderPath === null) {
    return;
  }
  const seen = new Set<string>();
  for (const modelId of modelIds) {
    if (seen.has(modelId)) {
      continue;
    }
    seen.add(modelId);
    await rebuildFolderCentroid(db, folderPath, modelId);
  }
}

/**
 * Recompute or clear the embedding for one item.
 * Returns whether a vector row is present afterwards.
 * Rebuilds the item's folder centroid when the vector row changes.
 */
export async function recomputeItemEmbedding(
  db: SqlEmbeddingDb,
  engine: EmbeddingEngine,
  source: ItemEmbeddingSource,
): Promise<boolean> {
  const folderPath = await itemFolderPath(db, source.itemId);
  const built = buildEmbedText({
    title: source.title,
    description: source.description,
    tagNames: source.tagNames,
    body: source.body ?? undefined,
  });

  if (built === null) {
    const stored = await getItemEmbedding(db, source.itemId);
    await deleteItemEmbedding(db, source.itemId);
    if (stored !== null) {
      await rebuildCentroidsForItemFolder(db, folderPath, [
        stored.modelId,
        engine.modelId,
      ]);
    }
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
  const modelIds = [engine.modelId];
  if (stored !== null) {
    modelIds.push(stored.modelId);
  }
  await rebuildCentroidsForItemFolder(db, folderPath, modelIds);
  return true;
}

/**
 * Rank neighbors by cosine within the query item's folder ancestor chain
 * (same folder → parents → root), matching related fallback scope (#603/#414).
 *
 * Candidate embeddings are loaded already scoped in SQL (C ≪ E); ranking uses
 * bounded top-k rather than a full sort.
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
  const allowedFolders = folderPathAncestorChain(queryFolder);

  const candidates = await listItemEmbeddingsForModelInFolders(
    db,
    engine.modelId,
    allowedFolders,
    itemId,
  );

  return rankByCosine(
    queryRow.vector,
    candidates.map((row) => ({ id: row.itemId, vector: row.vector })),
    limit,
  );
}

export type SuggestItemFolderMovesOptions = {
  /** Vault-relative folder paths to consider (from folder tree). */
  candidateFolderPaths: readonly string[];
};

/**
 * Hybrid rank of destination folders for moving an item (centroid + name overlap).
 * Excludes the item's current folder and Inbox. Zero-score folders are dropped.
 */
export async function suggestItemFolderMoves(
  db: SqlEmbeddingDb,
  engine: EmbeddingEngine,
  itemId: string,
  limit: number,
  options: SuggestItemFolderMovesOptions,
): Promise<FolderMoveSuggestion[]> {
  if (limit <= 0) {
    throw new Error("suggestItemFolderMoves limit must be positive");
  }

  const metaRows = await db.select<{
    folder_path: string;
    title: string;
    description: string;
  }>(
    `SELECT folder_path, title, description FROM items WHERE id = ?`,
    [itemId],
  );
  const meta = metaRows[0];
  if (meta === undefined) {
    return [];
  }

  const tagRows = await db.select<{ name: string }>(
    `SELECT t.name AS name
     FROM item_tags it
     INNER JOIN tags t ON t.id = it.tag_id
     WHERE it.item_id = ?`,
    [itemId],
  );
  const tagNames = tagRows.map((row) => row.name);
  const itemTokens = itemSignalNameTokens({
    title: meta.title,
    description: meta.description,
    tagNames,
  });

  const queryRow = await getItemEmbedding(db, itemId);
  const queryVector =
    queryRow !== null && queryRow.modelId === engine.modelId
      ? queryRow.vector
      : null;

  const centroids =
    queryVector !== null
      ? await listFolderCentroidsForModel(db, engine.modelId)
      : [];
  const centroidByPath = new Map(
    centroids.map((row) => [row.folderPath, row] as const),
  );

  const currentFolder = meta.folder_path;
  const scored: FolderMoveSuggestion[] = [];

  for (const folderPath of options.candidateFolderPaths) {
    if (isInboxFolderName(folderPath)) {
      continue;
    }
    if (
      folderPath === currentFolder ||
      (isInboxFolderName(currentFolder) && isInboxFolderName(folderPath))
    ) {
      continue;
    }

    const nameOverlap = tokenSetOverlap(
      itemTokens,
      folderPathNameTokens(folderPath),
    );

    let centroidUnit: number | null = null;
    if (queryVector !== null) {
      const centroid = centroidByPath.get(folderPath);
      if (centroid !== undefined && centroid.itemCount > 0) {
        try {
          centroidUnit = cosineToUnitInterval(
            cosineSimilarity(queryVector, centroid.centroid),
          );
        } catch {
          centroidUnit = null;
        }
      }
    }

    const score = hybridFolderMoveScore({ centroidUnit, nameOverlap });
    if (score <= 0) {
      continue;
    }
    scored.push({ path: folderPath, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.path.localeCompare(b.path);
  });
  return scored.slice(0, limit);
}
