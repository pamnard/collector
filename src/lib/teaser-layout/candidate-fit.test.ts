import { describe, expect, it } from "vitest";
import { isSpanAllowedOnBoard } from "./board";
import {
  compositionId,
  isAllowedComposition,
  listAllowedCompositions,
  type TeaserComposition,
} from "./composition";
import {
  compositionsFittingCandidate,
  measureDescLen,
  measureTitleLen,
  teaserFitsComposition,
} from "./candidate-fit";
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

describe("measureTitleLen / measureDescLen", () => {
  it("buckets title length", () => {
    expect(measureTitleLen("")).toBe("none");
    expect(measureTitleLen("   ")).toBe("none");
    expect(measureTitleLen("x".repeat(40))).toBe("short");
    expect(measureTitleLen("x".repeat(41))).toBe("medium");
    expect(measureTitleLen("x".repeat(80))).toBe("medium");
    expect(measureTitleLen("x".repeat(81))).toBe("long");
  });

  it("buckets description length", () => {
    expect(measureDescLen("")).toBe("none");
    expect(measureDescLen("   ")).toBe("none");
    expect(measureDescLen("x".repeat(120))).toBe("short");
    expect(measureDescLen("x".repeat(121))).toBe("long");
  });
});

describe("teaserFitsComposition / compositionsFittingCandidate", () => {
  it("rejects hasImage compositions when thumbnail is null", () => {
    const t = teaser({ id: "a", thumbnail: null, title: "Hello" });
    const withImage = listAllowedCompositions().find(
      (c) => c.span === "1x1" && c.hasImage && c.hasTitle && c.titleLen === "short",
    );
    expect(withImage).toBeDefined();
    expect(teaserFitsComposition(t, withImage as TeaserComposition)).toBe(false);

    const noImage = listAllowedCompositions().find(
      (c) =>
        c.span === "1x1" &&
        !c.hasImage &&
        c.hasTitle &&
        c.titleLen === "short" &&
        c.desc === "none" &&
        c.extra === "date",
    );
    expect(noImage).toBeDefined();
    expect(teaserFitsComposition(t, noImage as TeaserComposition)).toBe(true);
  });

  it("requires desc none when description is empty", () => {
    const t = teaser({ id: "a", title: "Hello", description: "" });
    const withDesc = listAllowedCompositions().find(
      (c) =>
        c.span === "1x1" &&
        !c.hasImage &&
        c.hasTitle &&
        c.titleLen === "short" &&
        c.desc === "short",
    );
    expect(withDesc).toBeDefined();
    expect(teaserFitsComposition(t, withDesc as TeaserComposition)).toBe(false);
  });

  it("returns only allowed compositions for span on the board", () => {
    const t = teaser({
      id: "a",
      title: "Hello",
      thumbnail: "cover.webp",
      imageForm: "landscape",
      description: "Lead",
    });
    const fits = compositionsFittingCandidate(t, "2x2", "2x2");
    expect(fits.length).toBe(0);

    const onWide = compositionsFittingCandidate(t, "2x2", "4x2");
    expect(onWide.length).toBeGreaterThan(0);
    for (const c of onWide) {
      expect(c.span).toBe("2x2");
      expect(c.form).toBe("landscape");
      expect(isAllowedComposition(c)).toBe(true);
      expect(isSpanAllowedOnBoard("4x2", c.span)).toBe(true);
      expect(teaserFitsComposition(t, c)).toBe(true);
      expect(
        listAllowedCompositions().some(
          (a) => compositionId(a) === compositionId(c),
        ),
      ).toBe(true);
    }
  });

  it("requires composition form to match measured imageForm", () => {
    const portrait = teaser({
      id: "p",
      title: "Hello",
      thumbnail: "cover.webp",
      imageForm: "portrait",
      description: "",
    });
    const landscapeComp = listAllowedCompositions().find(
      (c) =>
        c.span === "2x1" &&
        c.hasImage &&
        c.form === "landscape" &&
        c.hasTitle &&
        c.titleLen === "short" &&
        c.desc === "none",
    );
    expect(landscapeComp).toBeDefined();
    expect(teaserFitsComposition(portrait, landscapeComp as TeaserComposition)).toBe(
      false,
    );

    const portraitComp = listAllowedCompositions().find(
      (c) =>
        c.span === "1x2" &&
        c.hasImage &&
        c.form === "portrait" &&
        c.hasTitle &&
        c.titleLen === "short" &&
        c.desc === "none",
    );
    expect(portraitComp).toBeDefined();
    expect(teaserFitsComposition(portrait, portraitComp as TeaserComposition)).toBe(
      true,
    );
  });

  it("rejects image compositions when cover URL exists but imageForm is null", () => {
    const t = teaser({
      id: "a",
      title: "Hello",
      thumbnail: "cover.webp",
      imageForm: null,
    });
    const withImage = listAllowedCompositions().find(
      (c) => c.span === "1x1" && c.hasImage && c.hasTitle && c.titleLen === "short",
    );
    expect(withImage).toBeDefined();
    expect(teaserFitsComposition(t, withImage as TeaserComposition)).toBe(false);
  });

  it("rejects text compositions when the teaser has a measured cover form", () => {
    const t = teaser({
      id: "a",
      title: "Hello",
      thumbnail: "cover.webp",
      imageForm: "landscape",
    });
    const textOnly = listAllowedCompositions().find(
      (c) =>
        c.span === "1x1" &&
        !c.hasImage &&
        c.hasTitle &&
        c.titleLen === "short" &&
        c.desc === "none" &&
        c.extra === "date",
    );
    expect(textOnly).toBeDefined();
    expect(teaserFitsComposition(t, textOnly as TeaserComposition)).toBe(false);
  });
});
