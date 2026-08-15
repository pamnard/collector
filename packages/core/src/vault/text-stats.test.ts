import { describe, expect, it } from "vitest";
import { countTextStats } from "./text-stats.js";

describe("countTextStats", () => {
  it("returns zeros for empty body", () => {
    expect(countTextStats("")).toEqual({ wordCount: 0, characterCount: 0 });
  });

  it("counts characters including spaces", () => {
    expect(countTextStats("ab cd").characterCount).toBe(5);
  });

  it("counts unicode words and code points", () => {
    const stats = countTextStats("привет мир");
    expect(stats.wordCount).toBe(2);
    expect(stats.characterCount).toBe(10);
  });

  it("counts emoji as code points, not as letter-words", () => {
    const stats = countTextStats("hi 👋");
    expect(stats.wordCount).toBe(1);
    expect(stats.characterCount).toBe(4);
  });

  it("does not treat YAML-looking lines specially — caller passes body only", () => {
    const body = "title: not frontmatter\n\nhello world";
    const stats = countTextStats(body);
    expect(stats.wordCount).toBe(5);
    expect(stats.characterCount).toBe(Array.from(body).length);
  });
});
