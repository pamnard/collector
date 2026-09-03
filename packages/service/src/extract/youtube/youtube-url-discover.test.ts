import { describe, expect, it } from "vitest";
import {
  discoverYoutubeCandidates,
  parseYoutubeShortcode,
} from "./youtube-url-discover.js";

describe("parseYoutubeShortcode (#317)", () => {
  it("parses watch, shorts, and youtu.be", () => {
    expect(
      parseYoutubeShortcode("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
    expect(
      parseYoutubeShortcode("https://www.youtube.com/shorts/AbCdEfGhIjK"),
    ).toBe("AbCdEfGhIjK");
    expect(parseYoutubeShortcode("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(
      parseYoutubeShortcode("https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=12"),
    ).toBe("dQw4w9WgXcQ");
  });

  it("rejects non-YouTube and channel URLs", () => {
    expect(
      parseYoutubeShortcode("https://www.instagram.com/p/CxYz123AbCd/"),
    ).toBeNull();
    expect(
      parseYoutubeShortcode("https://www.youtube.com/@channel"),
    ).toBeNull();
    expect(parseYoutubeShortcode("not a url")).toBeNull();
  });
});

describe("discoverYoutubeCandidates (#317)", () => {
  it("finds bare YouTube URLs in the body", () => {
    const body = "See https://www.youtube.com/watch?v=dQw4w9WgXcQ please.";
    expect(discoverYoutubeCandidates({ body })).toEqual([
      {
        extractorId: "youtube",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        shortcode: "dQw4w9WgXcQ",
      },
    ]);
  });

  it("finds shorts and markdown-linked youtu.be", () => {
    const body =
      "Clip [here](https://youtu.be/AbCdEfGhIjK) and https://www.youtube.com/shorts/XyZ12345678";
    expect(discoverYoutubeCandidates({ body })).toEqual([
      {
        extractorId: "youtube",
        url: "https://www.youtube.com/watch?v=AbCdEfGhIjK",
        shortcode: "AbCdEfGhIjK",
      },
      {
        extractorId: "youtube",
        url: "https://www.youtube.com/watch?v=XyZ12345678",
        shortcode: "XyZ12345678",
      },
    ]);
  });

  it("does not claim Instagram or Pinterest URLs", () => {
    const body = [
      "https://www.instagram.com/p/CxYz123AbCd/",
      "https://www.pinterest.com/pin/111222333444/",
    ].join("\n");
    expect(discoverYoutubeCandidates({ body })).toEqual([]);
  });

  it("does not treat frontmatter url as an import candidate", () => {
    expect(
      discoverYoutubeCandidates({
        body: "caption only — url already in frontmatter after import",
        frontmatterUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      }),
    ).toEqual([]);
  });

  it("dedupes by video id across body links", () => {
    const body = [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "[again](https://youtu.be/dQw4w9WgXcQ?t=30)",
      "https://www.youtube.com/shorts/OtherVid99xx",
    ].join("\n");
    const candidates = discoverYoutubeCandidates({
      body,
      frontmatterUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    expect(candidates.map((c) => c.shortcode).sort()).toEqual([
      "OtherVid99xx",
      "dQw4w9WgXcQ",
    ]);
    expect(candidates).toHaveLength(2);
    expect(candidates.every((c) => c.extractorId === "youtube")).toBe(true);
  });
});
