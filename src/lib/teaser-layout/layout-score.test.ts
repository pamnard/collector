import { describe, expect, it } from "vitest";
import type { TeaserComposition } from "./composition";
import {
  formSpanFitBonus,
  layoutDiversityBonus,
  layoutFullWidthStackPenalty,
  layoutLeftMassBonus,
  layoutSpanOrientationBias,
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
  it("rewards portrait on tall 1x2; landscape prefers 2x2 over 2x1 slabs", () => {
    expect(formSpanFitBonus("portrait", "1x2")).toBeGreaterThan(
      formSpanFitBonus("portrait", "2x1"),
    );
    expect(formSpanFitBonus("landscape", "2x2")).toBeGreaterThan(
      formSpanFitBonus("landscape", "2x1"),
    );
    expect(formSpanFitBonus("landscape", "2x1")).toBe(0);
    expect(formSpanFitBonus("square", "1x1")).toBeGreaterThan(0);
    expect(formSpanFitBonus(null, "1x1")).toBe(0);
  });
});

describe("layoutSpanOrientationBias", () => {
  it("prefers tall 1x2 over wide 2x1", () => {
    expect(layoutSpanOrientationBias(["1x2", "1x2"])).toBeGreaterThan(
      layoutSpanOrientationBias(["2x1", "2x1"]),
    );
    expect(layoutSpanOrientationBias(["1x1", "2x2"])).toBe(0);
  });
});

describe("layoutDiversityBonus / layoutLeftMassBonus", () => {
  it("prefers more distinct spans without forbidding mono", () => {
    expect(layoutDiversityBonus(["1x2", "1x2", "1x2", "1x2"])).toBeGreaterThan(
      0,
    );
    expect(layoutDiversityBonus(["2x2", "1x1", "1x1", "1x2"])).toBeGreaterThan(
      layoutDiversityBonus(["1x2", "1x2", "1x2", "1x2"]),
    );
    // A 2×1 slab must not inflate diversity over a pure 1×1 fill.
    expect(layoutDiversityBonus(["1x1", "1x1", "1x1", "1x1"])).toBe(
      layoutDiversityBonus(["2x1", "1x1", "1x1"]),
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
        [
          { span: "2x1", col: 0, row: 0 },
          { span: "2x1", col: 0, row: 1 },
        ],
        2,
      ),
    ).toBeGreaterThan(0);
    expect(
      layoutFullWidthStackPenalty(
        [
          { span: "1x1", col: 0, row: 0 },
          { span: "1x1", col: 1, row: 0 },
          { span: "1x1", col: 0, row: 1 },
          { span: "1x1", col: 1, row: 1 },
        ],
        2,
      ),
    ).toBe(0);
    expect(
      layoutFullWidthStackPenalty(
        [
          { span: "1x2", col: 0, row: 0 },
          { span: "1x2", col: 1, row: 0 },
        ],
        2,
      ),
    ).toBe(0);
  });

  it("penalizes stacked wide 2x1 bands even when side slots exist", () => {
    // Board 4×2: two landscape slabs stacked on the left + 1×1 column on the right.
    // Old rule required ALL slots to be full-board bands → penalty was 0 here.
    expect(
      layoutFullWidthStackPenalty(
        [
          { span: "2x1", col: 0, row: 0 },
          { span: "2x1", col: 0, row: 1 },
          { span: "1x1", col: 2, row: 0 },
          { span: "1x1", col: 3, row: 0 },
          { span: "1x1", col: 2, row: 1 },
          { span: "1x1", col: 3, row: 1 },
        ],
        4,
      ),
    ).toBeGreaterThan(0);
    // Two wide bands side-by-side on one row are not a vertical stack.
    expect(
      layoutFullWidthStackPenalty(
        [
          { span: "2x1", col: 0, row: 0 },
          { span: "2x1", col: 2, row: 0 },
          { span: "1x1", col: 0, row: 1 },
          { span: "1x1", col: 1, row: 1 },
          { span: "1x1", col: 2, row: 1 },
          { span: "1x1", col: 3, row: 1 },
        ],
        4,
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
          span: "2x2",
          hasImage: true,
          form: "landscape",
          desc: "short",
          extra: "date",
        }),
      ),
    ).toBe(3 + 1 + 1 + formSpanFitBonus("landscape", "2x2"));
  });

  it("sums content so a landscape 2x2 beats a flat 1x1 and beats a 2x1 slab", () => {
    const landscape = teaser({
      id: "a",
      thumbnail: "a.webp",
      imageForm: "landscape",
      description: "Lead",
    });
    const oneByOne = {
      teaser: landscape,
      composition: composition({
        span: "1x1",
        hasImage: true,
        form: "landscape",
        desc: "short",
        extra: "date",
      }),
    };
    const twoByOne = {
      teaser: landscape,
      composition: composition({
        span: "2x1",
        hasImage: true,
        form: "landscape",
        desc: "short",
        extra: "date",
      }),
    };
    const twoByTwo = {
      teaser: landscape,
      composition: composition({
        span: "2x2",
        hasImage: true,
        form: "landscape",
        desc: "short",
        extra: "date",
      }),
    };
    expect(scoreSlot(twoByTwo.teaser, twoByTwo.composition)).toBeGreaterThan(
      scoreSlot(oneByOne.teaser, oneByOne.composition),
    );
    expect(scoreSlot(twoByTwo.teaser, twoByTwo.composition)).toBeGreaterThan(
      scoreSlot(twoByOne.teaser, twoByOne.composition),
    );
  });

  it("soft-prefers two landscape 1x1 over one landscape 2x1 slab", () => {
    const landscape = teaser({
      id: "a",
      thumbnail: "a.webp",
      imageForm: "landscape",
      description: "Lead",
    });
    const bottomRow = [
      {
        teaser: { ...landscape, id: "c" },
        composition: composition({
          span: "1x1" as const,
          hasImage: true,
          form: "landscape" as const,
          desc: "short" as const,
          extra: "date" as const,
        }),
        col: 0,
        row: 1,
      },
      {
        teaser: { ...landscape, id: "d" },
        composition: composition({
          span: "1x1" as const,
          hasImage: true,
          form: "landscape" as const,
          desc: "short" as const,
          extra: "date" as const,
        }),
        col: 1,
        row: 1,
      },
    ];
    const twoOnes = [
      {
        teaser: { ...landscape, id: "a" },
        composition: composition({
          span: "1x1",
          hasImage: true,
          form: "landscape",
          desc: "short",
          extra: "date",
        }),
        col: 0,
        row: 0,
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
        col: 1,
        row: 0,
      },
      ...bottomRow,
    ];
    const oneWide = [
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
        row: 0,
      },
      ...bottomRow,
    ];
    expect(scoreLayout(twoOnes, 2)).toBeGreaterThan(scoreLayout(oneWide, 2));
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
        row: 0,
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
        row: 0,
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
        row: 1,
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
        row: 1,
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
        row: 0,
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
        row: 0,
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
        row: 0,
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
        row: 1,
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
        row: 1,
      },
    ];
    expect(scoreLayout(diverse, 4)).toBeGreaterThan(scoreLayout(mono, 4));
  });

  it("soft-prefers a tall 1x2 pair over a wide 2x1 pair when content is equal", () => {
    const plain = teaser({ id: "a", description: "Lead" });
    const tall = [
      {
        teaser: { ...plain, id: "a" },
        composition: composition({
          span: "1x2",
          desc: "short",
          extra: "date",
        }),
        col: 0,
        row: 0,
      },
      {
        teaser: { ...plain, id: "b" },
        composition: composition({
          span: "1x2",
          desc: "short",
          extra: "date",
        }),
        col: 1,
        row: 0,
      },
    ];
    const wide = [
      {
        teaser: { ...plain, id: "a" },
        composition: composition({
          span: "2x1",
          desc: "short",
          extra: "date",
        }),
        col: 0,
        row: 0,
      },
      {
        teaser: { ...plain, id: "b" },
        composition: composition({
          span: "2x1",
          desc: "short",
          extra: "date",
        }),
        col: 0,
        row: 1,
      },
    ];
    expect(scoreLayout(tall, 2)).toBeGreaterThan(scoreLayout(wide, 2));
  });

  it("soft-demotes left stacked 2x1 slabs beside a side column", () => {
    const landscape = teaser({
      id: "a",
      thumbnail: "a.webp",
      imageForm: "landscape",
      description: "Lead",
    });
    const stackedWide = [
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
        row: 0,
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
        col: 0,
        row: 1,
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
        col: 2,
        row: 0,
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
        col: 3,
        row: 0,
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
        col: 2,
        row: 1,
      },
      {
        teaser: { ...landscape, id: "f" },
        composition: composition({
          span: "1x1",
          hasImage: true,
          form: "landscape",
          desc: "short",
          extra: "date",
        }),
        col: 3,
        row: 1,
      },
    ];
    const mixed = [
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
        row: 0,
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
        row: 0,
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
        row: 0,
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
        row: 1,
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
        row: 1,
      },
    ];
    expect(scoreLayout(mixed, 4)).toBeGreaterThan(scoreLayout(stackedWide, 4));
  });
});
