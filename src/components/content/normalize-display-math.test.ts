import { describe, expect, it } from "vitest";
import { normalizeStandaloneDoubleDollarMath } from "./normalize-display-math";

describe("normalizeStandaloneDoubleDollarMath (#463)", () => {
  it("rewrites a whole-line $$...$$ into multiline block fences", () => {
    const input =
      "intro\n\n$$\\frac{a}{b}$$\n\nout";
    expect(normalizeStandaloneDoubleDollarMath(input)).toBe(
      "intro\n\n$$\n\\frac{a}{b}\n$$\n\nout",
    );
  });

  it("leaves already-multiline blocks unchanged", () => {
    const input = "$$\n\\frac{a}{b}\n$$";
    expect(normalizeStandaloneDoubleDollarMath(input)).toBe(input);
  });

  it("does not touch mid-sentence single-dollar math", () => {
    const input = "share $\\ge 80\\%$ of runtime";
    expect(normalizeStandaloneDoubleDollarMath(input)).toBe(input);
  });
});
