import { describe, expect, it } from "vitest";
import type { TeaserComposition } from "./composition";
import {
  MIN_LAYOUT_SCORE,
  scoreLayout,
  scoreSlot,
} from "./layout-score";
import type { RelatedTeaser } from "../related-teaser";

function teaser(overrides: Partial<RelatedTeaser> & Pick<RelatedTeaser, "id">): RelatedTeaser {
  return {
    title: "Title",
    thumbnail: null,
    description: "",
    createdAt: "2020-01-01T00:00:00.000Z",
    contentType: "bookmark",
    ...overrides,
  };
}

function composition(
  overrides: Partial<TeaserComposition> = {},
): TeaserComposition {
  return {
    span: "1x1",
    hasImage: false,
    form: "none",
    hasTitle: true,
    titleLen: "short",
    desc: "none",
    extra: "none",
    ...overrides,
  };
}

describe("scoreSlot / scoreLayout", () => {
  it("scores text slot as 1", () => {
    const t = teaser({ id: "a" });
    expect(scoreSlot(t, composition())).toBe(1);
  });

  it("scores image slot with thumbnail as 3 plus extras", () => {
    const t = teaser({
      id: "a",
      thumbnail: "x.webp",
      description: "Lead text",
    });
    expect(
      scoreSlot(
        t,
        composition({
          hasImage: true,
          form: "landscape",
          desc: "short",
          extra: "date",
        }),
      ),
    ).toBe(3 + 1 + 1);
  });

  it("sums slot scores for a layout", () => {
    const t1 = teaser({ id: "a", thumbnail: "a.webp" });
    const t2 = teaser({ id: "b" });
    const total = scoreLayout([
      {
        teaser: t1,
        composition: composition({ hasImage: true, form: "square" }),
      },
      { teaser: t2, composition: composition() },
    ]);
    expect(total).toBe(3 + 1);
    expect(total).toBeGreaterThanOrEqual(MIN_LAYOUT_SCORE);
  });
});
