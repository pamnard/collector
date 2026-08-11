import { describe, expect, it } from "vitest";
import type { RelatedTeaser } from "../related-teaser";
import { MIN_LAYOUT_SCORE } from "./layout-score";
import { pickTeaserLayout } from "./pick-layout";

function teaser(
  overrides: Partial<RelatedTeaser> & Pick<RelatedTeaser, "id" | "title">,
): RelatedTeaser {
  return {
    thumbnail: null,
    description: "",
    createdAt: "2020-01-01T00:00:00.000Z",
    contentType: "bookmark",
    ...overrides,
  };
}

function textPool(count: number): RelatedTeaser[] {
  return Array.from({ length: count }, (_, i) =>
    teaser({ id: `t${i}`, title: `Title ${i}` }),
  );
}

describe("pickTeaserLayout", () => {
  it("returns null on shortfall for 4x2", () => {
    expect(pickTeaserLayout([teaser({ id: "only", title: "One" })], "4x2")).toBeNull();
  });

  it("fills an all-text pool on 2x2 with unique teaser ids", () => {
    const pool = textPool(4);
    const pick = pickTeaserLayout(pool, "2x2");
    expect(pick).not.toBeNull();
    expect(pick!.board).toBe("2x2");
    expect(pick!.score).toBeGreaterThanOrEqual(MIN_LAYOUT_SCORE);
    const ids = pick!.slots.map((s) => s.teaserId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(pick!.slots.every((s) => s.span !== "2x2")).toBe(true);
  });

  it("prefers image compositions when thumbnails are available", () => {
    const withCovers = textPool(4).map((t, i) =>
      i < 2 ? { ...t, thumbnail: `c${i}.webp` } : t,
    );
    const pick = pickTeaserLayout(withCovers, "2x2");
    expect(pick).not.toBeNull();
    const textOnly = pickTeaserLayout(textPool(4), "2x2");
    expect(textOnly).not.toBeNull();
    expect(pick!.score).toBeGreaterThan(textOnly!.score);
    expect(pick!.slots.some((s) => s.composition.hasImage)).toBe(true);
  });

  it("is stable across repeated calls", () => {
    const pool = textPool(6);
    const a = pickTeaserLayout(pool, "3x2");
    const b = pickTeaserLayout(pool, "3x2");
    expect(a).toEqual(b);
  });

  it("reuses the same candidate pool when shrinking boards", () => {
    const pool = textPool(8);
    const wide = pickTeaserLayout(pool, "4x2");
    const narrow = pickTeaserLayout(pool, "2x2");
    expect(wide).not.toBeNull();
    expect(narrow).not.toBeNull();
    expect(narrow!.slots.every((s) => s.span !== "2x2")).toBe(true);
    for (const slot of narrow!.slots) {
      expect(pool.some((t) => t.id === slot.teaserId)).toBe(true);
    }
  });
});
