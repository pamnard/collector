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

export type CosineHit = {
  id: string;
  score: number;
};

/** Higher score ranks first; equal scores break ties by ascending id. */
function compareHitsDesc(left: CosineHit, right: CosineHit): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  return left.id.localeCompare(right.id);
}

/** `a` is strictly worse than `b` under desc ranking (comes later in the result). */
function isWorseThan(a: CosineHit, b: CosineHit): boolean {
  return compareHitsDesc(a, b) > 0;
}

/**
 * Min-heap keyed by "worseness": the worst of the current top-k sits at index 0.
 * Avoids sorting the full scored set when k ≪ n.
 */
function siftUp(heap: CosineHit[], index: number): void {
  let i = index;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (!isWorseThan(heap[i]!, heap[parent]!)) {
      break;
    }
    const tmp = heap[i]!;
    heap[i] = heap[parent]!;
    heap[parent] = tmp;
    i = parent;
  }
}

function siftDown(heap: CosineHit[], index: number): void {
  const n = heap.length;
  let i = index;
  for (;;) {
    const left = i * 2 + 1;
    const right = left + 1;
    let worst = i;
    if (left < n && isWorseThan(heap[left]!, heap[worst]!)) {
      worst = left;
    }
    if (right < n && isWorseThan(heap[right]!, heap[worst]!)) {
      worst = right;
    }
    if (worst === i) {
      break;
    }
    const tmp = heap[i]!;
    heap[i] = heap[worst]!;
    heap[worst] = tmp;
    i = worst;
  }
}

function pushTopK(heap: CosineHit[], hit: CosineHit, k: number): void {
  if (heap.length < k) {
    heap.push(hit);
    siftUp(heap, heap.length - 1);
    return;
  }
  // Keep only if strictly better than the current worst of the top-k.
  if (compareHitsDesc(hit, heap[0]!) >= 0) {
    return;
  }
  heap[0] = hit;
  siftDown(heap, 0);
}

export function rankByCosine(
  query: Float32Array,
  candidates: CosineCandidate[],
  k: number,
): CosineHit[] {
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

  const topK: CosineHit[] = [];
  for (const candidate of candidates) {
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
    pushTopK(
      topK,
      {
        id: candidate.id,
        score: dot / (queryNormSqrt * Math.sqrt(normB)),
      },
      k,
    );
  }

  topK.sort(compareHitsDesc);
  return topK;
}
