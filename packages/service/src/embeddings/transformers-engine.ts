import {
  EMBEDDING_DIMS,
  EMBEDDING_MODEL_ID,
  type EmbeddingEngine,
} from "@collector/core";

type FeatureExtractionPipeline = (
  text: string,
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array | number[] } | Float32Array>;

/**
 * Local Transformers.js engine for paraphrase-multilingual-MiniLM-L12-v2 (#413).
 * Lazy-loads weights on first encode (HF cache on disk).
 */
export class TransformersEmbeddingEngine implements EmbeddingEngine {
  readonly modelId = EMBEDDING_MODEL_ID;
  readonly dims = EMBEDDING_DIMS;

  private pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

  private async getPipeline(): Promise<FeatureExtractionPipeline> {
    if (!this.pipelinePromise) {
      this.pipelinePromise = (async () => {
        const { pipeline } = await import("@huggingface/transformers");
        return (await pipeline(
          "feature-extraction",
          this.modelId,
        )) as FeatureExtractionPipeline;
      })();
    }
    return this.pipelinePromise;
  }

  async encode(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) {
      return [];
    }
    const extractor = await this.getPipeline();
    const out: Float32Array[] = [];
    for (const text of texts) {
      if (text.trim().length === 0) {
        throw new Error("TransformersEmbeddingEngine.encode empty text");
      }
      const result = await extractor(text, {
        pooling: "mean",
        normalize: true,
      });
      const data =
        result instanceof Float32Array
          ? result
          : result.data instanceof Float32Array
            ? result.data
            : Float32Array.from(result.data);
      if (data.length !== this.dims) {
        throw new Error(
          `TransformersEmbeddingEngine dims mismatch: got ${data.length}, expected ${this.dims}`,
        );
      }
      out.push(new Float32Array(data));
    }
    return out;
  }
}
