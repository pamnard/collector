import type { SqlExecutor, SqlReader } from "@collector/db";
import type { ItemEmbeddingRefreshInput, ItemEmbeddingsPort } from "@collector/core";
import type {
  EmbeddingEngine,
  SimilarItemHit,
} from "@collector/core";
import {
  FakeEmbeddingEngine,
  findSimilarItemIds,
  recomputeItemEmbedding,
} from "@collector/core/node";
import { TransformersEmbeddingEngine } from "./transformers-engine.js";

type SqlDb = SqlExecutor & SqlReader;

export type ItemEmbeddingsService = ItemEmbeddingsPort & {
  findSimilarItems(itemId: string, limit: number): Promise<SimilarItemHit[]>;
  readonly engine: EmbeddingEngine;
};

export function resolveEmbeddingEngine(
  override?: EmbeddingEngine,
): EmbeddingEngine {
  if (override) {
    return override;
  }
  const mode = process.env.COLLECTOR_EMBEDDINGS_ENGINE?.trim();
  if (mode === "fake") {
    return new FakeEmbeddingEngine();
  }
  if (mode === "transformers") {
    return new TransformersEmbeddingEngine();
  }
  return new TransformersEmbeddingEngine();
}

export function createItemEmbeddingsService(deps: {
  getDb: () => SqlDb;
  engine?: EmbeddingEngine;
}): ItemEmbeddingsService {
  const engine = resolveEmbeddingEngine(deps.engine);

  return {
    engine,
    async refresh(inputs: ItemEmbeddingRefreshInput[]): Promise<void> {
      if (inputs.length === 0) {
        return;
      }
      const db = deps.getDb();
      for (const input of inputs) {
        await recomputeItemEmbedding(db, engine, input);
      }
    },
    async findSimilarItems(
      itemId: string,
      limit: number,
    ): Promise<SimilarItemHit[]> {
      return findSimilarItemIds(deps.getDb(), engine, itemId, limit);
    },
  };
}
