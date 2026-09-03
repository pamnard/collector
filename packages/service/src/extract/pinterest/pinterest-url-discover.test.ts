import { describe, expect, it } from "vitest";
import {
  discoverPinterestCandidates,
  parsePinterestPinIdFromSegment,
  parsePinterestShortcode,
} from "./pinterest-url-discover.js";

describe("parsePinterestPinIdFromSegment (#34)", () => {
  it("parses numeric and slug--id segments", () => {
    expect(parsePinterestPinIdFromSegment("2885187256207927")).toBe(
      "2885187256207927",
    );
    expect(
      parsePinterestPinIdFromSegment(
        "dive-into-serenity-blue-lagoon--2885187256207927",
      ),
    ).toBe("2885187256207927");
  });

  it("rejects board-like and empty segments", () => {
    expect(parsePinterestPinIdFromSegment("ideas")).toBeNull();
    expect(parsePinterestPinIdFromSegment("")).toBeNull();
  });
});

describe("parsePinterestShortcode (#34)", () => {
  it("parses pin paths on pinterest hosts", () => {
    expect(
      parsePinterestShortcode("https://www.pinterest.com/pin/1234567890/"),
    ).toBe("1234567890");
    expect(
      parsePinterestShortcode(
        "https://pinterest.com/pin/some-title--9876543210/?utm=1",
      ),
    ).toBe("9876543210");
    expect(
      parsePinterestShortcode("https://ru.pinterest.com/pin/555666777888/"),
    ).toBe("555666777888");
  });

  it("parses pin.it short links", () => {
    expect(parsePinterestShortcode("https://pin.it/1uTuGaTJV")).toBe(
      "pinit:1uTuGaTJV",
    );
  });

  it("parses ccTLD pinterest hosts", () => {
    expect(
      parsePinterestShortcode("https://www.pinterest.co.uk/pin/1234567890/"),
    ).toBe("1234567890");
    expect(
      parsePinterestShortcode("https://pinterest.de/pin/title--9876543210/"),
    ).toBe("9876543210");
  });

  it("rejects boards, profiles, search, and non-Pinterest", () => {
    expect(
      parsePinterestShortcode("https://www.pinterest.com/user/board/"),
    ).toBeNull();
    expect(
      parsePinterestShortcode("https://www.pinterest.com/search/pins/?q=cats"),
    ).toBeNull();
    expect(
      parsePinterestShortcode("https://www.instagram.com/p/CxYz123AbCd/"),
    ).toBeNull();
    expect(parsePinterestShortcode("not a url")).toBeNull();
  });
});

describe("discoverPinterestCandidates (#34)", () => {
  it("finds bare Pinterest pin URLs in the body", () => {
    const body = "See https://www.pinterest.com/pin/111222333444/ please.";
    expect(discoverPinterestCandidates({ body })).toEqual([
      {
        extractorId: "pinterest",
        url: "https://www.pinterest.com/pin/111222333444/",
        shortcode: "111222333444",
      },
    ]);
  });

  it("finds pin.it and markdown-linked pins", () => {
    const body =
      "Look [pin](https://pin.it/AbCdEfGh) and https://www.pinterest.com/pin/slug--999888777666/";
    expect(discoverPinterestCandidates({ body })).toEqual([
      {
        extractorId: "pinterest",
        url: "https://pin.it/AbCdEfGh",
        shortcode: "pinit:AbCdEfGh",
      },
      {
        extractorId: "pinterest",
        url: "https://www.pinterest.com/pin/999888777666/",
        shortcode: "999888777666",
      },
    ]);
  });

  it("does not claim Instagram or board URLs", () => {
    const body = [
      "https://www.instagram.com/p/CxYz123AbCd/",
      "https://www.pinterest.com/alice/my-board/",
    ].join("\n");
    expect(discoverPinterestCandidates({ body })).toEqual([]);
  });

  it("does not treat frontmatter url as an import candidate", () => {
    expect(
      discoverPinterestCandidates({
        body: "caption only — url already in frontmatter after import",
        frontmatterUrl: "https://www.pinterest.com/pin/424242424242/",
      }),
    ).toEqual([]);
  });

  it("dedupes by shortcode across body links", () => {
    const body = [
      "https://www.pinterest.com/pin/111222333444/",
      "[again](https://ru.pinterest.com/pin/title--111222333444/?utm=1)",
      "https://pin.it/OtherCode99",
    ].join("\n");
    const candidates = discoverPinterestCandidates({
      body,
      frontmatterUrl: "https://www.pinterest.com/pin/111222333444/",
    });
    expect(candidates.map((c) => c.shortcode).sort()).toEqual([
      "111222333444",
      "pinit:OtherCode99",
    ]);
    expect(candidates).toHaveLength(2);
    expect(candidates.every((c) => c.extractorId === "pinterest")).toBe(true);
  });
});
