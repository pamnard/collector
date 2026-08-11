import { describe, expect, it } from "vitest";
import type { TeaserComposition } from "./composition";
import {
  MIN_LAYOUT_SCORE,
  formSpanFitBonus,
  layoutDiversityBonus,
  layoutFullWidthStackPenalty,
  layoutLeftMassBonus,
  scoreLayout,
  scoreSlot,
} from "./layout-score";
import type { RelatedTeaser } from "../related-teaser";

function teaser(overrides: Partial<RelatedTeaser> & Pick<RelatedTeaser, "id">): RelatedTeaser {
  return {
    title: "Title",
    thumbnail: null,
    imageForm: null,
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

describe("formSpanFitBonus", () => {
  it("rewards portrait on tall 1x2 and landscape on wide 2x1", () => {
    expect(formSpanFitBonus("portrait", "1x2")).toBeGreaterThan(
      formSpanFitBonus("portrait", "2x1"),
    );
    expect(formSpanFitBonus("landscape", "2x1")).toBeGreaterThan(
      formSpanFitBonus("landscape", "1x2"),
    );
    expect(formSpanFitBonus("square", "1x1")).toBeGreaterThan(0);
    expect(formSpanFitBonus(null, "1x1")).toBe(0);
  });
});

describe("layoutDiversityBonus / layoutLeftMassBonus", () => {
  it("prefers more distinct spans without forbidding mono", () => {
    expect(layoutDiversityBonus(["1x2", "1x2", "1x2", "1x2"])).toBeGreaterThan(
      0,
    );
    expect(layoutDiversityBonus(["2x2", "1x1", "1x1", "2x1"])).toBeGreaterThan(
      layoutDiversityBonus(["1x2", "1x2", "1x2", "1x2"]),
    );
  });

  it("prefers visual mass on the left", () => {
    const leftHeavy = layoutLeftMassBonus(
      [
        { span: "2x2", col: 0 },
        { span: "1x1", col: 2 },
        { span: "1x1", col: 3 },
      ],
      4,
    );
    const rightHeavy = layoutLeftMassBonus(
      [
        { span: "1x1", col: 0 },
        { span: "1x1", col: 1 },
        { span: "2x2", col: 2 },
      ],
      4,
    );
    expect(leftHeavy).toBeGreaterThan(rightHeavy);
  });

  it("penalizes stacked full-width bands but not a normal grid", () => {
    expect(
      layoutFullWidthStackPenalty(
        [{ span: "2x1" }, { span: "2x1" }],
        2,
      ),
    ).toBeGreaterThan(0);
    expect(
      layoutFullWidthStackPenalty(
        [
          { span: "1x1" },
          { span: "1x1" },
          { span: "1x1" },
          { span: "1x1" },
        ],
        2,
      ),
    ).toBe(0);
    expect(
      layoutFullWidthStackPenalty(
        [{ span: "1x2" }, { span: "1x2" }],
        2,
      ),
    ).toBe(0);
  });
});

describe("scoreSlot / scoreLayout", () => {
  it("scores text slot as 1", () => {
    const t = teaser({ id: "a" });
    expect(scoreSlot(t, composition())).toBe(1);
  });

  it("scores image slot with thumbnail as 3 plus extras and form-span fit", () => {
    const t = teaser({
      id: "a",
      thumbnail: "x.webp",
      imageForm: "landscape",
      description: "Lead text",
    });
    expect(
      scoreSlot(
        t,
        composition({
          span: "2x1",
          hasImage: true,
          form: "landscape",
          desc: "short",
          extra: "date",
        }),
      ),
    ).toBe(3 + 1 + 1 + formSpanFitBonus("landscape", "2x1"));
  });

  it("sums content scores so preferred wide tiles beat flat 1x1 and beat two giants", () => {
    const landscape = teaser({
      id: "a",
      thumbnail: "a.webp",
      imageForm: "landscape",
      description: "Lead",
    });
    const eightOnes = Array.from({ length: 8 }, (_, i) => ({
      teaser: { ...landscape, id: `t${i}` },
      composition: composition({
        span: "1x1",
        hasImage: true,
        form: "landscape",
        desc: "short",
        extra: "date",
      }),
    }));
    const fourTwos = Array.from({ length: 4 }, (_, i) => ({
      teaser: { ...landscape, id: `w${i}` },
      composition: composition({
        span: "2x1",
        hasImage: true,
        form: "landscape",
        desc: "short",
        extra: "date",
      }),
    }));
    const twoGiants = Array.from({ length: 2 }, (_, i) => ({
      teaser: { ...landscape, id: `g${i}` },
      composition: composition({
        span: "2x2",
        hasImage: true,
        form: "landscape",
        desc: "short",
        extra: "date",
      }),
    }));
    const content = (
      slots: { teaser: RelatedTeaser; composition: TeaserComposition }[],
    ) => slots.reduce((sum, s) => sum + scoreSlot(s.teaser, s.composition), 0);
    expect(content(fourTwos)).toBeGreaterThan(content(eightOnes));
    expect(content(fourTwos)).toBeGreaterThan(content(twoGiants));
    expect(content(eightOnes)).toBeGreaterThanOrEqual(MIN_LAYOUT_SCORE);
  });

  it("soft-prefers diverse span mix over mono when content is otherwise similar", () => {
    const landscape = teaser({
      id: "a",
      thumbnail: "a.webp",
      imageForm: "landscape",
      description: "Lead",
    });
    const mono = [
      {
        teaser: { ...landscape, id: "a" },
        composition: composition({
          span: "2x1",
          hasImage: true,
          form: "landscape",
          desc: "short",
          extra: "date",
        }),
        col: 0,
      },
      {
        teaser: { ...landscape, id: "b" },
        composition: composition({
          span: "2x1",
          hasImage: true,
          form: "landscape",
          desc: "short",
          extra: "date",
        }),
        col: 2,
      },
      {
        teaser: { ...landscape, id: "c" },
        composition: composition({
          span: "2x1",
          hasImage: true,
          form: "landscape",
          desc: "short",
          extra: "date",
        }),
        col: 0,
      },
      {
        teaser: { ...landscape, id: "d" },
        composition: composition({
          span: "2x1",
          hasImage: true,
          form: "landscape",
          desc: "short",
          extra: "date",
        }),
        col: 2,
      },
    ];
    const diverse = [
      {
        teaser: { ...landscape, id: "a" },
        composition: composition({
          span: "2x2",
          hasImage: true,
          form: "landscape",
          desc: "short",
          extra: "date",
        }),
        col: 0,
      },
      {
        teaser: { ...landscape, id: "b" },
        composition: composition({
          span: "1x1",
          hasImage: true,
          form: "landscape",
          desc: "short",
          extra: "date",
        }),
        col: 2,
      },
      {
        teaser: { ...landscape, id: "c" },
        composition: composition({
          span: "1x1",
          hasImage: true,
          form: "landscape",
          desc: "short",
          extra: "date",
        }),
        col: 3,
      },
      {
        teaser: { ...landscape, id: "d" },
        composition: composition({
          span: "1x1",
          hasImage: true,
          form: "landscape",
          desc: "short",
          extra: "date",
        }),
        col: 2,
      },
      {
        teaser: { ...landscape, id: "e" },
        composition: composition({
          span: "1x1",
          hasImage: true,
          form: "landscape",
          desc: "short",
          extra: "date",
        }),
        col: 3,
      },
    ];
    expect(scoreLayout(diverse, 4)).toBeGreaterThan(scoreLayout(mono, 4));
  });
});
