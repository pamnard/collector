import { describe, expect, it } from "vitest";
import blacklistJson from "./composition-blacklist.json";
import {
  COMPOSITION_BLACKLIST,
  compositionId,
  isAllowedComposition,
  isStructurallyValidComposition,
  listAllowedCompositions,
  listAllStructurallyValidCompositions,
  parseCompositionId,
  type TeaserComposition,
} from "./composition";

function base(overrides: Partial<TeaserComposition> = {}): TeaserComposition {
  return {
    span: "1x1",
    hasImage: true,
    form: "landscape",
    hasTitle: true,
    titleLen: "short",
    desc: "none",
    extra: "none",
    ...overrides,
  };
}

describe("isStructurallyValidComposition", () => {
  it("rejects form when there is no image", () => {
    expect(
      isStructurallyValidComposition(
        base({ hasImage: false, form: "square" }),
      ),
    ).toBe(false);
  });

  it("rejects form none when there is an image", () => {
    expect(
      isStructurallyValidComposition(base({ hasImage: true, form: "none" })),
    ).toBe(false);
  });

  it("rejects titleLen when there is no title", () => {
    expect(
      isStructurallyValidComposition(
        base({ hasTitle: false, titleLen: "short" }),
      ),
    ).toBe(false);
  });

  it("rejects titleLen none when there is a title", () => {
    expect(
      isStructurallyValidComposition(
        base({ hasTitle: true, titleLen: "none" }),
      ),
    ).toBe(false);
  });

  it("accepts no-image with form none and no-title with titleLen none", () => {
    expect(
      isStructurallyValidComposition(
        base({
          hasImage: false,
          form: "none",
          hasTitle: false,
          titleLen: "none",
        }),
      ),
    ).toBe(true);
  });

  it("accepts image + form and title + titleLen", () => {
    expect(isStructurallyValidComposition(base())).toBe(true);
  });
});

describe("compositionId / parseCompositionId", () => {
  it("round-trips a few fixtures", () => {
    const fixtures: TeaserComposition[] = [
      base(),
      base({
        span: "2x2",
        hasImage: false,
        form: "none",
        hasTitle: true,
        titleLen: "long",
        desc: "short",
        extra: "date_type",
      }),
      base({
        span: "1x2",
        form: "portrait",
        hasTitle: false,
        titleLen: "none",
        desc: "long",
        extra: "date",
      }),
    ];
    for (const c of fixtures) {
      const id = compositionId(c);
      expect(parseCompositionId(id)).toEqual(c);
      expect(compositionId(parseCompositionId(id))).toBe(id);
    }
  });

  it("matches the vitrine id format", () => {
    expect(
      compositionId(
        base({
          span: "1x1",
          hasImage: true,
          form: "landscape",
          hasTitle: true,
          titleLen: "long",
          desc: "short",
          extra: "date",
        }),
      ),
    ).toBe(
      "span-1x1__img__landscape__title__long__desc-short__extra-date",
    );
  });
});

describe("blacklist and whitelist", () => {
  it("loads 223 blacklist ids into COMPOSITION_BLACKLIST", () => {
    expect(Array.isArray(blacklistJson)).toBe(true);
    expect(blacklistJson).toHaveLength(223);
    expect(COMPOSITION_BLACKLIST.size).toBe(223);
  });

  it("every blacklist id is structurally valid and in the full space", () => {
    const allIds = new Set(
      listAllStructurallyValidCompositions().map(compositionId),
    );
    expect(allIds.size).toBe(576);
    for (const id of blacklistJson) {
      expect(allIds.has(id)).toBe(true);
      const parsed = parseCompositionId(id);
      expect(isStructurallyValidComposition(parsed)).toBe(true);
      expect(isAllowedComposition(parsed)).toBe(false);
    }
  });

  it("listAllowedCompositions has 353 entries none of which are blacklisted", () => {
    const allowed = listAllowedCompositions();
    expect(allowed).toHaveLength(353);
    for (const c of allowed) {
      expect(COMPOSITION_BLACKLIST.has(compositionId(c))).toBe(false);
      expect(isAllowedComposition(c)).toBe(true);
    }
  });
});
