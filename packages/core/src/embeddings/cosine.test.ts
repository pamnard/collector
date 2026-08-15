import { describe, expect, it } from "vitest";
import { cosineSimilarity, rankByCosine } from "./cosine.js";
import { fingerprintEmbedText, needsRecompute } from "./invalidation.js";

describe("cosineSimilarity", () => {
  it("scores identical unit vectors as 1", () => {
    const a = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1);
  });

  it("scores orthogonal vectors as 0", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0);
  });
});

describe("rankByCosine", () => {
  it("returns top-k by descending score", () => {
    const query = new Float32Array([1, 0]);
    const hits = rankByCosine(
      query,
      [
        { id: "far.md", vector: new Float32Array([0, 1]) },
        { id: "near.md", vector: new Float32Array([0.9, 0.1]) },
        { id: "mid.md", vector: new Float32Array([0.5, 0.5]) },
      ],
      2,
    );
    expect(hits.map((hit) => hit.id)).toEqual(["near.md", "mid.md"]);
  });

  it("matches full-sort top-k on small fixtures", () => {
    const query = new Float32Array([1, 0, 0]);
    const candidates = [
      { id: "d", vector: new Float32Array([0.1, 0.9, 0]) },
      { id: "a", vector: new Float32Array([0.8, 0.2, 0]) },
      { id: "c", vector: new Float32Array([0.4, 0.6, 0]) },
      { id: "b", vector: new Float32Array([0.6, 0.4, 0]) },
      { id: "e", vector: new Float32Array([0.05, 0.95, 0]) },
    ];
    const fullSort = [...candidates]
      .map((candidate) => ({
        id: candidate.id,
        score: cosineSimilarity(query, candidate.vector),
      }))
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return left.id.localeCompare(right.id);
      })
      .slice(0, 3);
    expect(rankByCosine(query, candidates, 3)).toEqual(fullSort);
  });

  it("breaks score ties with stable ascending id order", () => {
    const query = new Float32Array([1, 0]);
    const same = new Float32Array([1, 0]);
    const hits = rankByCosine(
      query,
      [
        { id: "z.md", vector: same },
        { id: "a.md", vector: same },
        { id: "m.md", vector: same },
      ],
      2,
    );
    expect(hits.map((hit) => hit.id)).toEqual(["a.md", "m.md"]);
    expect(hits[0]!.score).toBeCloseTo(hits[1]!.score);
  });
});

describe("needsRecompute", () => {
  it("recomputes when fingerprint or revision changes", () => {
    const current = {
      modelId: "m",
      contentRevision: 2,
      inputFingerprint: fingerprintEmbedText("a"),
    };
    expect(needsRecompute(null, current)).toBe(true);
    expect(
      needsRecompute(
        {
          modelId: "m",
          contentRevision: 2,
          inputFingerprint: fingerprintEmbedText("a"),
        },
        current,
      ),
    ).toBe(false);
    expect(
      needsRecompute(
        {
          modelId: "m",
          contentRevision: 1,
          inputFingerprint: fingerprintEmbedText("a"),
        },
        current,
      ),
    ).toBe(true);
    expect(
      needsRecompute(
        {
          modelId: "m",
          contentRevision: 2,
          inputFingerprint: fingerprintEmbedText("b"),
        },
        current,
      ),
    ).toBe(true);
  });
});
