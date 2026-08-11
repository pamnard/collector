export type EmbedTextMode =
  | "title_desc_tags"
  | "title_desc"
  | "title_tags_snippet"
  | "title_snippet"
  | "title_tags"
  | "title_only";

export type EmbedTextResult = {
  text: string;
  mode: EmbedTextMode;
};

export type ItemEmbeddingRow = {
  itemId: string;
  modelId: string;
  contentRevision: number;
  inputFingerprint: string;
  dims: number;
  vector: Float32Array;
  updatedAt: string;
};

export type ItemEmbeddingPut = {
  itemId: string;
  modelId: string;
  contentRevision: number;
  inputFingerprint: string;
  vector: Float32Array;
  updatedAt: string;
};

export interface EmbeddingEngine {
  readonly modelId: string;
  readonly dims: number;
  encode(texts: string[]): Promise<Float32Array[]>;
}

export type SimilarItemHit = {
  id: string;
  score: number;
};
