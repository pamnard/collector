import type { SqlReader } from "@collector/db";
import type { ItemEmbeddingRefreshInput } from "../adapters/types.js";
import { sqlInPlaceholders } from "../index/sql-index-helpers.js";
import { buildEmbedText } from "./build-embed-text.js";

export type EmbeddingReconcileTickOptions = {
  vaultId: string;
  modelId: string;
  /** Max refresh inputs to return this tick. */
  batchSize: number;
  /** Max missing/stale candidate rows to scan this tick. */
  scanLimit: number;
};

export type EmbeddingReconcileTickStats = {
  scanned: number;
  skippedNoSignal: number;
};

export type EmbeddingReconcileTickResult = {
  inputs: ItemEmbeddingRefreshInput[];
  stats: EmbeddingReconcileTickStats;
};

type CandidateRow = {
  item_id: string;
  title: string;
  description: string;
  content_revision: number;
  body: string | null;
};

/**
 * Select index items missing an embedding (or stale model_id) that have enough
 * signal for buildEmbedText, for a bounded refreshEmbeddings enqueue (#742).
 */
export async function planEmbeddingReconcileTick(
  db: SqlReader,
  options: EmbeddingReconcileTickOptions,
): Promise<EmbeddingReconcileTickResult> {
  if (options.batchSize <= 0) {
    throw new Error("embedding reconcile batchSize must be positive");
  }
  if (options.scanLimit <= 0) {
    throw new Error("embedding reconcile scanLimit must be positive");
  }
  if (!options.vaultId.trim()) {
    throw new Error("embedding reconcile vaultId is required");
  }
  if (!options.modelId.trim()) {
    throw new Error("embedding reconcile modelId is required");
  }

  const candidates = await db.select<CandidateRow>(
    `SELECT i.id AS item_id,
            i.title AS title,
            i.description AS description,
            i.content_revision AS content_revision,
            f.content AS body
     FROM items i
     LEFT JOIN item_embeddings e ON e.item_id = i.id
     LEFT JOIN items_fts f ON f.item_id = i.id
     WHERE i.vault_id = ?
       AND (e.item_id IS NULL OR e.model_id != ?)
     ORDER BY i.id ASC
     LIMIT ?`,
    [options.vaultId, options.modelId, options.scanLimit],
  );

  const tagsByItemId = await loadTagNamesByItemId(
    db,
    candidates.map((row) => row.item_id),
  );

  const inputs: ItemEmbeddingRefreshInput[] = [];
  let skippedNoSignal = 0;

  for (const row of candidates) {
    const tagNames = tagsByItemId.get(row.item_id) ?? [];
    const body =
      row.body !== null && row.body.length > 0 ? row.body : undefined;
    if (
      buildEmbedText({
        title: row.title,
        description: row.description,
        tagNames,
        body,
      }) === null
    ) {
      skippedNoSignal += 1;
      continue;
    }
    if (inputs.length >= options.batchSize) {
      continue;
    }
    const input: ItemEmbeddingRefreshInput = {
      itemId: row.item_id,
      title: row.title,
      description: row.description,
      tagNames,
      contentRevision: row.content_revision,
    };
    if (body !== undefined) {
      input.body = body;
    }
    inputs.push(input);
  }

  return {
    inputs,
    stats: {
      scanned: candidates.length,
      skippedNoSignal,
    },
  };
}

async function loadTagNamesByItemId(
  db: SqlReader,
  itemIds: string[],
): Promise<Map<string, string[]>> {
  const tagsByItemId = new Map<string, string[]>();
  if (itemIds.length === 0) {
    return tagsByItemId;
  }

  const rows = await db.select<{ item_id: string; name: string }>(
    `SELECT it.item_id AS item_id, t.name AS name
     FROM item_tags it
     INNER JOIN tags t ON t.id = it.tag_id
     WHERE it.item_id IN (${sqlInPlaceholders(itemIds.length)})`,
    itemIds,
  );

  for (const row of rows) {
    const list = tagsByItemId.get(row.item_id);
    if (list) {
      list.push(row.name);
    } else {
      tagsByItemId.set(row.item_id, [row.name]);
    }
  }
  return tagsByItemId;
}
