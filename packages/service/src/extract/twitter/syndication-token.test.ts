import { describe, expect, it } from "vitest";
import {
  syndicationTweetResultUrl,
  syndicationTweetToken,
} from "./syndication-token.js";

describe("syndicationTweetToken (#954)", () => {
  it("matches the embed formula for a known id", () => {
    // ((20 / 1e15) * Math.PI).toString(36) with zeros/dots stripped
    expect(syndicationTweetToken("20")).toBe(
      ((20 / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, ""),
    );
  });

  it("rejects non-numeric ids", () => {
    expect(() => syndicationTweetToken("abc")).toThrow(/numeric/);
  });

  it("builds tweet-result URL with id, token, lang, and features", () => {
    const url = new URL(syndicationTweetResultUrl("20"));
    expect(url.origin + url.pathname).toBe(
      "https://cdn.syndication.twimg.com/tweet-result",
    );
    expect(url.searchParams.get("id")).toBe("20");
    expect(url.searchParams.get("token")).toBe(syndicationTweetToken("20"));
    expect(url.searchParams.get("lang")).toBe("en");
    expect(url.searchParams.get("features")).toContain(
      "tfw_tweet_edit_backend:on",
    );
  });

  it("stays deterministic for long snowflake ids (Number precision, react-tweet parity)", () => {
    const longId = "1840916898869567611";
    expect(Number(longId) > Number.MAX_SAFE_INTEGER).toBe(true);
    expect(syndicationTweetToken(longId)).toBe(
      ((Number(longId) / 1e15) * Math.PI)
        .toString(36)
        .replace(/(0+|\.)/g, ""),
    );
    expect(syndicationTweetToken(longId)).toBe(syndicationTweetToken(longId));
  });
});
