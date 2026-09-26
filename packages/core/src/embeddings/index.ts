/** Browser-safe embedding helpers (no Node builtins). */
export { EMBEDDING_DIMS, EMBEDDING_MODEL_ID } from "./constants.js";
export { buildEmbedText, extractPlainSnippet } from "./build-embed-text.js";
export { cosineSimilarity, rankByCosine } from "./cosine.js";
export {
  fingerprintEmbedText,
  needsRecompute,
} from "./invalidation.js";
export {
  planEmbeddingReconcileTick,
} from "./embedding-reconcile.js";
export type {
  EmbeddingReconcileTickOptions,
  EmbeddingReconcileTickResult,
  EmbeddingReconcileTickStats,
} from "./embedding-reconcile.js";
export type {
  EmbeddingEngine,
  EmbedTextMode,
  EmbedTextResult,
  FolderMoveSuggestion,
  ItemEmbeddingRow,
  SimilarItemHit,
} from "./types.js";
export {
  cosineToUnitInterval,
  folderPathNameTokens,
  hybridFolderMoveScore,
  itemSignalNameTokens,
  tokenizeForFolderNameOverlap,
  tokenSetOverlap,
  FOLDER_MOVE_CENTROID_WEIGHT,
  FOLDER_MOVE_NAME_WEIGHT,
} from "./folder-move-score.js";
