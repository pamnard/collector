/** Node/host embedding runtime (SQLite store + engines). Not for Vite UI. */
export { FakeEmbeddingEngine } from "./fake-engine.js";
export {
  findSimilarItemIds,
  recomputeItemEmbedding,
} from "./item-embeddings.js";
export type { ItemEmbeddingSource } from "./item-embeddings.js";
export {
  deleteItemEmbedding,
  getItemEmbedding,
  listItemEmbeddingsForModel,
  putItemEmbedding,
  rewriteItemEmbeddingId,
} from "./embedding-store.js";
export type {
  EmbeddingEngine,
  ItemEmbeddingRow,
  SimilarItemHit,
} from "./types.js";
export { EMBEDDING_DIMS, EMBEDDING_MODEL_ID } from "./constants.js";
