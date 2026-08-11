export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity length mismatch: ${a.length} vs ${b.length}`,
    );
  }
  if (a.length === 0) {
    throw new Error("cosineSimilarity empty vectors");
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) {
    throw new Error("cosineSimilarity zero-norm vector");
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export type CosineCandidate = {
  id: string;
  vector: Float32Array;
};

export function rankByCosine(
  query: Float32Array,
  candidates: CosineCandidate[],
  k: number,
): Array<{ id: string; score: number }> {
  if (k <= 0) {
    throw new Error("rankByCosine k must be positive");
  }
  let queryNorm = 0;
  for (let i = 0; i < query.length; i += 1) {
    queryNorm += query[i]! * query[i]!;
  }
  if (queryNorm === 0) {
    throw new Error("cosineSimilarity zero-norm vector");
  }
  const queryNormSqrt = Math.sqrt(queryNorm);

  const scored = candidates.map((candidate) => {
    if (candidate.vector.length !== query.length) {
      throw new Error(
        `cosineSimilarity length mismatch: ${query.length} vs ${candidate.vector.length}`,
      );
    }
    let dot = 0;
    let normB = 0;
    for (let i = 0; i < query.length; i += 1) {
      const bv = candidate.vector[i]!;
      dot += query[i]! * bv;
      normB += bv * bv;
    }
    if (normB === 0) {
      throw new Error("cosineSimilarity zero-norm vector");
    }
    return {
      id: candidate.id,
      score: dot / (queryNormSqrt * Math.sqrt(normB)),
    };
  });
  scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.id.localeCompare(right.id);
  });
  return scored.slice(0, k);
}
