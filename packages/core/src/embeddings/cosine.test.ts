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
