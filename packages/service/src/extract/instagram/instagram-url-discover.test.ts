import { describe, expect, it } from "vitest";
import {
  discoverInstagramCandidates,
  parseInstagramShortcode,
} from "./instagram-url-discover.js";

describe("parseInstagramShortcode (#846)", () => {
  it("parses post, reel, reels, and tv paths", () => {
    expect(
      parseInstagramShortcode("https://www.instagram.com/p/CxYz123AbCd/"),
    ).toBe("CxYz123AbCd");
    expect(
      parseInstagramShortcode("https://instagram.com/reel/AbCdEfGhIjK"),
    ).toBe("AbCdEfGhIjK");
    expect(
      parseInstagramShortcode("https://www.instagram.com/reels/ReElSc0d3_1/"),
    ).toBe("ReElSc0d3_1");
    expect(parseInstagramShortcode("https://instagram.com/tv/TvSc0d3Code/")).toBe(
      "TvSc0d3Code",
    );
  });

  it("accepts mobile host and strips query", () => {
    expect(
      parseInstagramShortcode(
        "https://m.instagram.com/p/MobileCode11/?igsh=abc",
      ),
    ).toBe("MobileCode11");
  });

  it("rejects stories, profiles, non-Instagram, and bare handles", () => {
    expect(
      parseInstagramShortcode("https://www.instagram.com/stories/user/123/"),
    ).toBeNull();
    expect(
      parseInstagramShortcode("https://www.instagram.com/someuser/"),
    ).toBeNull();
    expect(
      parseInstagramShortcode("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBeNull();
    expect(parseInstagramShortcode("@someuser")).toBeNull();
    expect(parseInstagramShortcode("not a url")).toBeNull();
  });
});

describe("discoverInstagramCandidates (#846)", () => {
  it("finds bare Instagram URLs in the body", () => {
    const body =
      "See https://www.instagram.com/p/BarePostCode/ and more text.";
    expect(discoverInstagramCandidates({ body })).toEqual([
      {
        extractorId: "instagram",
        url: "https://www.instagram.com/p/BarePostCode/",
        shortcode: "BarePostCode",
      },
    ]);
  });

  it("finds Instagram URLs inside markdown links", () => {
    const body =
      "Watch [this reel](https://www.instagram.com/reel/MdLinkReel1/).";
    expect(discoverInstagramCandidates({ body })).toEqual([
      {
        extractorId: "instagram",
        url: "https://www.instagram.com/reel/MdLinkReel1/",
        shortcode: "MdLinkReel1",
      },
    ]);
  });

  it("does not claim non-Instagram URLs", () => {
    const body =
      "https://example.com/p/fake and https://www.youtube.com/watch?v=abc123xyz01";
    expect(discoverInstagramCandidates({ body })).toEqual([]);
  });

  it("considers frontmatter url when Instagram", () => {
    expect(
      discoverInstagramCandidates({
        body: "no links here",
        frontmatterUrl: "http://instagram.com/tv/FrontTvCode1/",
      }),
    ).toEqual([
      {
        extractorId: "instagram",
        url: "https://www.instagram.com/tv/FrontTvCode1/",
        shortcode: "FrontTvCode1",
      },
    ]);
  });

  it("ignores non-Instagram frontmatter url", () => {
    expect(
      discoverInstagramCandidates({
        body: "",
        frontmatterUrl: "https://example.com/page",
      }),
    ).toEqual([]);
  });

  it("dedupes by shortcode across body and frontmatter", () => {
    const body = [
      "https://www.instagram.com/p/SameCode123/",
      "[again](https://m.instagram.com/p/SameCode123/?utm=1)",
      "https://www.instagram.com/reel/OtherCode99/",
    ].join("\n");
    const candidates = discoverInstagramCandidates({
      body,
      frontmatterUrl: "https://www.instagram.com/p/SameCode123/",
    });
    expect(candidates.map((c) => c.shortcode).sort()).toEqual([
      "OtherCode99",
      "SameCode123",
    ]);
    expect(candidates).toHaveLength(2);
    expect(
      candidates.every((c) => c.extractorId === "instagram"),
    ).toBe(true);
  });

  it("ignores stories, profiles, and @handles in body", () => {
    const body = [
      "https://www.instagram.com/stories/alice/1234567890/",
      "https://www.instagram.com/alice/",
      "@alice",
    ].join("\n");
    expect(discoverInstagramCandidates({ body })).toEqual([]);
  });
});
