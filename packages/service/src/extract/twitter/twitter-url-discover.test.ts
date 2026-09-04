import { describe, expect, it } from "vitest";
import {
  discoverTwitterCandidates,
  parseTwitterShortcode,
  parseTwitterTarget,
} from "./twitter-url-discover.js";

describe("parseTwitterTarget (#954)", () => {
  it("parses status URLs on x.com / twitter.com / mobile", () => {
    expect(
      parseTwitterTarget("https://x.com/jack/status/20"),
    ).toEqual({ kind: "status", statusId: "20", username: "jack" });
    expect(
      parseTwitterTarget(
        "https://twitter.com/jack/status/20/photo/1?s=20",
      ),
    ).toEqual({ kind: "status", statusId: "20", username: "jack" });
    expect(
      parseTwitterTarget("https://mobile.twitter.com/i/status/1234567890"),
    ).toEqual({ kind: "status", statusId: "1234567890", username: null });
    expect(
      parseTwitterTarget("https://www.x.com/alice/status/999888777666"),
    ).toEqual({
      kind: "status",
      statusId: "999888777666",
      username: "alice",
    });
  });

  it("parses article URLs", () => {
    expect(
      parseTwitterTarget("https://x.com/SomeAuthor/article/AbCdEf123"),
    ).toEqual({
      kind: "article",
      articleId: "AbCdEf123",
      username: "SomeAuthor",
    });
    expect(
      parseTwitterTarget(
        "https://twitter.com/writer/article/xyz-99/?utm=1",
      ),
    ).toEqual({
      kind: "article",
      articleId: "xyz-99",
      username: "writer",
    });
  });

  it("parses t.co short links", () => {
    expect(parseTwitterTarget("https://t.co/AbCdEfGh")).toEqual({
      kind: "tco",
      code: "AbCdEfGh",
    });
  });

  it("rejects profiles, home, and non-Twitter", () => {
    expect(parseTwitterTarget("https://x.com/jack")).toBeNull();
    expect(parseTwitterTarget("https://x.com/home")).toBeNull();
    expect(
      parseTwitterTarget("https://www.instagram.com/p/CxYz123AbCd/"),
    ).toBeNull();
    expect(parseTwitterTarget("not a url")).toBeNull();
  });
});

describe("parseTwitterShortcode (#954)", () => {
  it("uses status id, article: prefix, and tco: prefix", () => {
    expect(parseTwitterShortcode("https://x.com/a/status/111")).toBe("111");
    expect(
      parseTwitterShortcode("https://x.com/a/article/Art99"),
    ).toBe("article:Art99");
    expect(parseTwitterShortcode("https://t.co/Short1")).toBe("tco:Short1");
  });
});

describe("discoverTwitterCandidates (#954)", () => {
  it("finds status URLs in the body", () => {
    const body = "See https://x.com/jack/status/20 please.";
    expect(discoverTwitterCandidates({ body })).toEqual([
      {
        extractorId: "twitter",
        url: "https://x.com/jack/status/20",
        shortcode: "20",
      },
    ]);
  });

  it("finds articles and t.co and markdown links", () => {
    const body = [
      "Look [tweet](https://t.co/AbCdEfGh)",
      "and https://x.com/writer/article/ArtId01/",
    ].join("\n");
    expect(discoverTwitterCandidates({ body })).toEqual([
      {
        extractorId: "twitter",
        url: "https://t.co/AbCdEfGh",
        shortcode: "tco:AbCdEfGh",
      },
      {
        extractorId: "twitter",
        url: "https://x.com/writer/article/ArtId01",
        shortcode: "article:ArtId01",
      },
    ]);
  });

  it("does not claim Instagram or profile URLs", () => {
    const body = [
      "https://www.instagram.com/p/CxYz123AbCd/",
      "https://x.com/jack",
    ].join("\n");
    expect(discoverTwitterCandidates({ body })).toEqual([]);
  });

  it("does not treat frontmatter url as an import candidate", () => {
    expect(
      discoverTwitterCandidates({
        body: "caption only — url already in frontmatter after import",
        frontmatterUrl: "https://x.com/jack/status/20",
      }),
    ).toEqual([]);
  });

  it("dedupes by shortcode across body links", () => {
    const body = [
      "https://x.com/jack/status/20",
      "[again](https://twitter.com/jack/status/20/photo/1)",
      "https://t.co/OtherCode99",
    ].join("\n");
    const candidates = discoverTwitterCandidates({
      body,
      frontmatterUrl: "https://x.com/jack/status/20",
    });
    expect(candidates.map((c) => c.shortcode).sort()).toEqual([
      "20",
      "tco:OtherCode99",
    ]);
    expect(candidates).toHaveLength(2);
    expect(candidates.every((c) => c.extractorId === "twitter")).toBe(true);
  });

  it("keeps status and article ids distinct", () => {
    const body = [
      "https://x.com/u/status/999",
      "https://x.com/u/article/999",
    ].join("\n");
    const candidates = discoverTwitterCandidates({ body });
    expect(candidates.map((c) => c.shortcode).sort()).toEqual([
      "999",
      "article:999",
    ]);
  });
});
