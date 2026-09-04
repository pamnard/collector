import { describe, expect, it } from "vitest";
import {
  discoverRedditCandidates,
  parseRedditShortcode,
  parseRedditTarget,
} from "./reddit-url-discover.js";

describe("parseRedditTarget (#955)", () => {
  it("parses /r/.../comments/{id} and /comments/{id}", () => {
    expect(
      parseRedditTarget(
        "https://www.reddit.com/r/pics/comments/abc123/some_title/",
      ),
    ).toEqual({
      kind: "post",
      submissionId: "abc123",
      subreddit: "pics",
    });
    expect(
      parseRedditTarget("https://old.reddit.com/comments/xyz789/"),
    ).toEqual({
      kind: "post",
      submissionId: "xyz789",
      subreddit: null,
    });
    expect(
      parseRedditTarget("https://np.reddit.com/r/ask/comments/1abcde/q/"),
    ).toEqual({
      kind: "post",
      submissionId: "1abcde",
      subreddit: "ask",
    });
  });

  it("parses redd.it short links", () => {
    expect(parseRedditTarget("https://redd.it/abc123")).toEqual({
      kind: "reddit_it",
      code: "abc123",
    });
  });

  it("parses mobile share /r/.../s/... links", () => {
    expect(
      parseRedditTarget("https://www.reddit.com/r/selfhosted/s/QcYMPXxChk"),
    ).toEqual({
      kind: "share",
      code: "QcYMPXxChk",
      scope: "r",
      name: "selfhosted",
    });
  });

  it("rejects subreddit roots, users, CDN, and foreign hosts", () => {
    expect(parseRedditTarget("https://www.reddit.com/r/pics/")).toBeNull();
    expect(parseRedditTarget("https://www.reddit.com/user/alice/")).toBeNull();
    expect(parseRedditTarget("https://i.redd.it/abc.jpg")).toBeNull();
    expect(parseRedditTarget("https://v.redd.it/xyz")).toBeNull();
    expect(
      parseRedditTarget("https://www.instagram.com/p/CxYz123AbCd/"),
    ).toBeNull();
    expect(parseRedditTarget("https://x.com/user/status/1")).toBeNull();
    expect(parseRedditTarget("not a url")).toBeNull();
  });
});

describe("parseRedditShortcode (#955)", () => {
  it("uses submission id or reddit:/share: prefix for short links", () => {
    expect(
      parseRedditShortcode(
        "https://www.reddit.com/r/pics/comments/abc123/title/",
      ),
    ).toBe("abc123");
    expect(parseRedditShortcode("https://redd.it/Short99")).toBe(
      "reddit:Short99",
    );
    expect(
      parseRedditShortcode(
        "https://www.reddit.com/r/selfhosted/s/QcYMPXxChk",
      ),
    ).toBe("share:QcYMPXxChk");
  });
});

describe("discoverRedditCandidates (#955)", () => {
  it("finds bare Reddit post URLs in the body", () => {
    const body =
      "See https://www.reddit.com/r/pics/comments/abc123/hello/ please.";
    expect(discoverRedditCandidates({ body })).toEqual([
      {
        extractorId: "reddit",
        url: "https://www.reddit.com/r/pics/comments/abc123/",
        shortcode: "abc123",
      },
    ]);
  });

  it("finds redd.it and markdown-linked posts", () => {
    const body =
      "Look [post](https://redd.it/AbCdEf) and https://old.reddit.com/r/ask/comments/zzz111/q/";
    expect(discoverRedditCandidates({ body })).toEqual([
      {
        extractorId: "reddit",
        url: "https://redd.it/AbCdEf",
        shortcode: "reddit:AbCdEf",
      },
      {
        extractorId: "reddit",
        url: "https://www.reddit.com/r/ask/comments/zzz111/",
        shortcode: "zzz111",
      },
    ]);
  });

  it("finds mobile share links so Import can appear", () => {
    const body = "https://www.reddit.com/r/selfhosted/s/QcYMPXxChk\n";
    expect(discoverRedditCandidates({ body })).toEqual([
      {
        extractorId: "reddit",
        url: "https://www.reddit.com/r/selfhosted/s/QcYMPXxChk",
        shortcode: "share:QcYMPXxChk",
      },
    ]);
  });

  it("does not claim Instagram, Twitter, or non-post Reddit URLs", () => {
    const body = [
      "https://www.instagram.com/p/CxYz123AbCd/",
      "https://x.com/user/status/123",
      "https://www.reddit.com/r/pics/",
      "https://i.redd.it/photo.jpg",
    ].join("\n");
    expect(discoverRedditCandidates({ body })).toEqual([]);
  });

  it("does not treat frontmatter url as an import candidate", () => {
    expect(
      discoverRedditCandidates({
        body: "caption only — url already in frontmatter after import",
        frontmatterUrl:
          "https://www.reddit.com/r/pics/comments/abc123/hello/",
      }),
    ).toEqual([]);
  });

  it("dedupes redd.it and /comments/{id} as the same submission", () => {
    const body = [
      "https://redd.it/abc123",
      "https://www.reddit.com/r/pics/comments/abc123/hello/",
    ].join("\n");
    expect(discoverRedditCandidates({ body })).toEqual([
      {
        extractorId: "reddit",
        url: "https://redd.it/abc123",
        shortcode: "reddit:abc123",
      },
    ]);
  });

  it("dedupes by shortcode across body links", () => {
    const body = [
      "https://www.reddit.com/r/pics/comments/abc123/hello/",
      "[again](https://old.reddit.com/r/pics/comments/abc123/hello/?utm=1)",
      "https://redd.it/Other99",
    ].join("\n");
    const candidates = discoverRedditCandidates({
      body,
      frontmatterUrl: "https://www.reddit.com/r/pics/comments/abc123/hello/",
    });
    expect(candidates.map((c) => c.shortcode).sort()).toEqual([
      "abc123",
      "reddit:Other99",
    ]);
    expect(candidates).toHaveLength(2);
    expect(candidates.every((c) => c.extractorId === "reddit")).toBe(true);
  });
});
