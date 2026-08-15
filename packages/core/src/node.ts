/**
 * Node-only filesystem adapter + host embedding runtime + markdownlint.
 * Do not import from the Vite UI bundle — use `@collector/core` there.
 */

export { NodeFileSystemAdapter } from "./adapters/node-fs.js";
export {
  EMBEDDING_DIMS,
  EMBEDDING_MODEL_ID,
  FakeEmbeddingEngine,
  deleteItemEmbedding,
  findSimilarItemIds,
  getItemEmbedding,
  listItemEmbeddingsForModel,
  putItemEmbedding,
  recomputeItemEmbedding,
} from "./embeddings/node.js";
export type {
  EmbeddingEngine,
  ItemEmbeddingRow,
  ItemEmbeddingSource,
  SimilarItemHit,
} from "./embeddings/node.js";

export { normalizeMarkdown } from "./markdown/normalize-markdown.js";
export type { NormalizeMarkdownResult } from "./markdown/normalize-markdown.js";
