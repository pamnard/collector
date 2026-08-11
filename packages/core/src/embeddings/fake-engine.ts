import { sha1Bytes } from "../util/sha1.js";
import { EMBEDDING_DIMS, EMBEDDING_MODEL_ID } from "./constants.js";
import type { EmbeddingEngine } from "./types.js";

/**
 * Deterministic stand-in for tests/CI — does not load Transformers.js weights.
 * Similar strings get correlated vectors via shared hash buckets.
 * Host/Node only — do not export from the UI `@collector/core` barrel.
 */
export class FakeEmbeddingEngine implements EmbeddingEngine {
  readonly modelId = EMBEDDING_MODEL_ID;
  readonly dims = EMBEDDING_DIMS;

  async encode(texts: string[]): Promise<Float32Array[]> {
    return texts.map((text) => this.encodeOne(text));
  }

  private encodeOne(text: string): Float32Array {
    const vector = new Float32Array(this.dims);
    const normalized = text.trim().toLowerCase();
    if (normalized.length === 0) {
      throw new Error("FakeEmbeddingEngine.encode empty text");
    }
    const tokens = normalized.split(/\s+/).filter((token) => token.length > 0);
    for (const token of tokens) {
      const digest = sha1Bytes([new TextEncoder().encode(token)]);
      for (let i = 0; i < this.dims; i += 1) {
        const byte = digest[i % digest.length]!;
        vector[i]! += (byte / 255) * 2 - 1;
      }
    }
    let norm = 0;
    for (let i = 0; i < this.dims; i += 1) {
      norm += vector[i]! * vector[i]!;
    }
    norm = Math.sqrt(norm);
    if (norm === 0) {
      throw new Error("FakeEmbeddingEngine produced zero vector");
    }
    for (let i = 0; i < this.dims; i += 1) {
      vector[i]! /= norm;
    }
    return vector;
  }
}
