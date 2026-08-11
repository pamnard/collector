/** Sentence-transformers model via Transformers.js ONNX port (#413). */
export const EMBEDDING_MODEL_ID =
  "Xenova/paraphrase-multilingual-MiniLM-L12-v2" as const;

export const EMBEDDING_DIMS = 384;

/** Max plain-text chars taken from body when description is missing. */
export const EMBED_SNIPPET_CHARS = 500;

/** Below this, a cleaned body snippet is treated as empty. */
export const EMBED_MIN_PLAIN_CHARS = 40;

/** Title shorter than this (after trim) is not enough alone for an embedding. */
export const EMBED_MIN_TITLE_CHARS = 1;
