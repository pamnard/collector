import { describe, expect, it } from "vitest";
import type { RelatedTeaser } from "../related-teaser";
import { pickTeaserLayout } from "./pick-layout";

function teaser(
  overrides: Partial<RelatedTeaser> & Pick<RelatedTeaser, "id" | "title">,
): RelatedTeaser {
  return {
    thumbnail: null,
    imageForm: null,
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

function landscapePool(count: number): RelatedTeaser[] {
  return Array.from({ length: count }, (_, i) =>
    teaser({
      id: `l${i}`,
      title: `Cover ${i}`,
      thumbnail: `l${i}.webp`,
      imageForm: "landscape",
      description: "Lead text for a landscape cover",
    }),
  );
}

function portraitPool(count: number): RelatedTeaser[] {
  return Array.from({ length: count }, (_, i) =>
    teaser({
      id: `p${i}`,
      title: `Portrait ${i}`,
      thumbnail: `p${i}.webp`,
      imageForm: "portrait",
      description: "Lead text for a portrait cover",
    }),
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
    expect(pick!.slots.length).toBeGreaterThan(0);
    const ids = pick!.slots.map((s) => s.teaserId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(pick!.slots.every((s) => s.span !== "2x2")).toBe(true);
  });

  it("prefers image compositions when thumbnails are available", () => {
    const withCovers = textPool(4).map((t, i) =>
      i < 2
        ? { ...t, thumbnail: `c${i}.webp`, imageForm: "square" as const }
        : t,
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

  it("does not pack eight landscape covers as all 1x1 on 4x2", () => {
    const pick = pickTeaserLayout(landscapePool(8), "4x2");
    expect(pick).not.toBeNull();
    expect(pick!.slots.length).toBeLessThan(8);
    expect(pick!.slots.some((s) => s.span === "2x1" || s.span === "2x2")).toBe(
      true,
    );
    expect(pick!.slots.every((s) => s.composition.form === "landscape")).toBe(
      true,
    );
  });

  it("avoids stacked full-width 2x1 slabs on 2x2 when a grid fit exists", () => {
    const pick = pickTeaserLayout(landscapePool(8), "2x2");
    expect(pick).not.toBeNull();
    const onlyStackedBands =
      pick!.slots.length === 2 &&
      pick!.slots.every((s) => s.span === "2x1");
    expect(onlyStackedBands).toBe(false);
  });

  it("with few covers still fills remaining cells instead of only two giant tiles", () => {
    const mixed = [
      ...landscapePool(2),
      ...textPool(6),
    ];
    const pick = pickTeaserLayout(mixed, "4x2");
    expect(pick).not.toBeNull();
    expect(pick!.slots.length).toBeGreaterThan(2);
    expect(pick!.slots.filter((s) => s.span === "2x2").length).toBeLessThan(2);
    expect(pick!.slots.some((s) => s.composition.hasImage)).toBe(true);
  });

  it("places portrait covers on tall spans and keeps an all-portrait board valid", () => {
    const pick = pickTeaserLayout(portraitPool(8), "4x2");
    expect(pick).not.toBeNull();
    expect(pick!.slots.length).toBeGreaterThan(0);
    expect(pick!.slots.every((s) => s.composition.form === "portrait")).toBe(
      true,
    );
    expect(pick!.slots.some((s) => s.span === "1x2" || s.span === "2x2")).toBe(
      true,
    );
    expect(pick!.slots.every((s) => s.span !== "1x1")).toBe(true);
  });

  it("prefers mixed spans when landscape and portrait covers are both available", () => {
    const pick = pickTeaserLayout(
      [...landscapePool(4), ...portraitPool(4)],
      "4x2",
    );
    expect(pick).not.toBeNull();
    const spans = new Set(pick!.slots.map((s) => s.span));
    expect(spans.size).toBeGreaterThan(1);
  });

  it("soft-prefers larger spans toward the left when mixed with 1x1 fillers", () => {
    const pick = pickTeaserLayout(
      [...landscapePool(4), ...portraitPool(4)],
      "4x2",
    );
    expect(pick).not.toBeNull();
    const heavy = pick!.slots.filter((s) => s.span !== "1x1");
    const light = pick!.slots.filter((s) => s.span === "1x1");
    if (heavy.length > 0 && light.length > 0) {
      const avgCol = (slots: typeof heavy) =>
        slots.reduce((sum, s) => sum + s.col, 0) / slots.length;
      expect(avgCol(heavy)).toBeLessThanOrEqual(avgCol(light));
    }
  });
});
