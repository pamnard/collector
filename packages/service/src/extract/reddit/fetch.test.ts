import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fetchRedditPost } from "./fetch.js";
import { parseRedditFetchTarget } from "./url.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/** Offline tests never hit the browser cookie dump. */
const OFFLINE = { cookieHeader: "reddit_session=fixture" } as const;

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

function textResponse(
  body: string,
  init: { status?: number; url?: string; headers?: Record<string, string> } = {},
): Response {
  const response = new Response(body, {
    status: init.status ?? 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...init.headers,
    },
  });
  if (init.url) {
    Object.defineProperty(response, "url", { value: init.url });
  }
  return response;
}

function jsonResponse(
  body: string,
  init: { status?: number; url?: string } = {},
): Response {
  const response = new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
  if (init.url) {
    Object.defineProperty(response, "url", { value: init.url });
  }
  return response;
}

describe("parseRedditFetchTarget (#955)", () => {
  it("parses post URLs, bare ids, redd.it, and share", () => {
    expect(
      parseRedditFetchTarget(
        "https://www.reddit.com/r/pics/comments/abc123/title/",
      ),
    ).toEqual({
      kind: "post",
      submissionId: "abc123",
      subreddit: "pics",
      sourceUrl: "https://www.reddit.com/r/pics/comments/abc123/",
    });
    expect(parseRedditFetchTarget("abc123")).toEqual({
      kind: "post",
      submissionId: "abc123",
      subreddit: null,
      sourceUrl: "https://www.reddit.com/comments/abc123/",
    });
    expect(parseRedditFetchTarget("https://redd.it/abc123")).toEqual({
      kind: "reddit_it",
      code: "abc123",
      sourceUrl: "https://redd.it/abc123",
    });
    expect(
      parseRedditFetchTarget(
        "https://www.reddit.com/r/selfhosted/s/QcYMPXxChk",
      ),
    ).toEqual({
      kind: "share",
      code: "QcYMPXxChk",
      scope: "r",
      name: "selfhosted",
      sourceUrl: "https://www.reddit.com/r/selfhosted/s/QcYMPXxChk",
    });
  });

  it("rejects non-posts", () => {
    expect(parseRedditFetchTarget("https://www.reddit.com/r/pics/")).toBeNull();
    expect(parseRedditFetchTarget("https://example.com/x")).toBeNull();
  });
});

describe("fetchRedditPost (#955)", () => {
  it("returns invalid_url for unsupported input", async () => {
    const result = await fetchRedditPost("https://example.com/x", {
      ...OFFLINE,
      fetchImpl: async () => {
        throw new Error("fetch must not be called for invalid_url");
      },
    });
    expect(result).toEqual({
      ok: false,
      code: "invalid_url",
      message: expect.stringContaining("Not a supported Reddit"),
    });
  });

  it("fails loudly when cookieHeader override is empty", async () => {
    const result = await fetchRedditPost(
      "https://www.reddit.com/r/pics/comments/text01/",
      {
        cookieHeader: "  ",
        fetchImpl: async () => {
          throw new Error("fetch must not run without cookies");
        },
      },
    );
    expect(result).toEqual({
      ok: false,
      code: "cookies_unavailable",
      message: expect.stringContaining("empty cookieHeader"),
    });
  });

  it("fetches a text self-post from .json", async () => {
    const json = readFixture("text-post.json");
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/comments/text01") && url.endsWith(".json")) {
        return jsonResponse(json);
      }
      throw new Error(`unexpected URL in text-post test: ${url}`);
    };

    const result = await fetchRedditPost(
      "https://www.reddit.com/r/askscience/comments/text01/why_is_the_sky_blue/",
      { ...OFFLINE, fetchImpl },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected success");
    }
    expect(result.value).toEqual({
      sourceUrl:
        "https://www.reddit.com/r/askscience/comments/text01/why_is_the_sky_blue/",
      submissionId: "text01",
      authorUsername: "curious_user",
      title: "Why is the sky blue?",
      selftext: "I was wondering about Rayleigh scattering.\n\nThanks!",
      media: [],
    });
  });

  it("fetches an image post and prefers i.redd.it over preview", async () => {
    const json = readFixture("image-post.json");
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/comments/img001") && url.endsWith(".json")) {
        return jsonResponse(json);
      }
      throw new Error(`unexpected URL in image-post test: ${url}`);
    };

    const result = await fetchRedditPost(
      "https://www.reddit.com/r/pics/comments/img001/a_nice_mountain/",
      { ...OFFLINE, fetchImpl },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected success");
    }
    expect(result.value.media).toEqual([
      { kind: "image", url: "https://i.redd.it/abc123mountain.jpg" },
    ]);
  });

  it("fetches a gallery with multiple images", async () => {
    const json = readFixture("gallery-post.json");
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/comments/gal001") && url.endsWith(".json")) {
        return jsonResponse(json);
      }
      throw new Error(`unexpected URL: ${url}`);
    };

    const result = await fetchRedditPost(
      "https://www.reddit.com/r/pics/comments/gal001/two_photos/",
      { ...OFFLINE, fetchImpl },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected success");
    }
    expect(result.value.media).toHaveLength(2);
    expect(result.value.media[0]?.url).toContain("mediaA.jpg");
    expect(result.value.media[1]?.url).toContain("mediaB.jpg");
  });

  it("fetches a hosted video via fallback_url", async () => {
    const json = readFixture("video-post.json");
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/comments/vid001") && url.endsWith(".json")) {
        return jsonResponse(json);
      }
      throw new Error(`unexpected URL: ${url}`);
    };

    const result = await fetchRedditPost(
      "https://www.reddit.com/r/videos/comments/vid001/cool_clip/",
      { ...OFFLINE, fetchImpl },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected success");
    }
    expect(result.value.media).toEqual([
      {
        kind: "video",
        url: "https://v.redd.it/videohash01/DASH_720.mp4?source=fallback",
      },
    ]);
  });

  it("succeeds for external link posts without media", async () => {
    const json = readFixture("link-post.json");
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/comments/link01") && url.endsWith(".json")) {
        return jsonResponse(json);
      }
      throw new Error(`unexpected URL: ${url}`);
    };

    const result = await fetchRedditPost(
      "https://www.reddit.com/r/worldnews/comments/link01/external_article/",
      { ...OFFLINE, fetchImpl },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected success");
    }
    expect(result.value.media).toEqual([]);
    expect(result.value.title).toBe("External article");
  });

  it("resolves redd.it then fetches .json", async () => {
    const json = readFixture("text-post.json");
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url === "https://redd.it/text01") {
        return textResponse("<html></html>", {
          url: "https://www.reddit.com/r/askscience/comments/text01/why_is_the_sky_blue/",
        });
      }
      if (url.includes("/comments/text01") && url.endsWith(".json")) {
        return jsonResponse(json);
      }
      throw new Error(`unexpected URL in redd.it test: ${url}`);
    };

    const result = await fetchRedditPost("https://redd.it/text01", {
      ...OFFLINE,
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected success");
    }
    expect(result.value.submissionId).toBe("text01");
  });

  it("resolves mobile share /s/ then fetches .json", async () => {
    const json = readFixture("text-post.json");
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      expect(headers.get("Cookie")).toBe(OFFLINE.cookieHeader);
      if (url === "https://www.reddit.com/r/selfhosted/s/QcYMPXxChk") {
        return textResponse("<html></html>", {
          url: "https://www.reddit.com/r/askscience/comments/text01/why_is_the_sky_blue/",
        });
      }
      if (url.includes("/comments/text01") && url.endsWith(".json")) {
        return jsonResponse(json);
      }
      throw new Error(`unexpected URL in share test: ${url}`);
    };

    const result = await fetchRedditPost(
      "https://www.reddit.com/r/selfhosted/s/QcYMPXxChk",
      { ...OFFLINE, fetchImpl },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected success");
    }
    expect(result.value.submissionId).toBe("text01");
  });

  it("maps 404 and 429 loudly", async () => {
    const notFound = await fetchRedditPost(
      "https://www.reddit.com/r/pics/comments/missing1/",
      {
        ...OFFLINE,
        fetchImpl: async () => jsonResponse("{}", { status: 404 }),
      },
    );
    expect(notFound).toEqual({
      ok: false,
      code: "not_found",
      message: expect.stringContaining("404"),
    });

    const limited = await fetchRedditPost(
      "https://www.reddit.com/r/pics/comments/rate01/",
      {
        ...OFFLINE,
        fetchImpl: async () => jsonResponse("{}", { status: 429 }),
      },
    );
    expect(limited).toEqual({
      ok: false,
      code: "rate_limited",
      message: expect.stringContaining("rate limited"),
    });
  });

  it("maps login-wall HTML to login_wall", async () => {
    const html = readFixture("login-wall.html");
    const result = await fetchRedditPost(
      "https://www.reddit.com/r/pics/comments/priv01/",
      {
        ...OFFLINE,
        fetchImpl: async () => textResponse(html, { status: 403 }),
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }
    expect(result.code).toBe("login_wall");
  });
});
