/**
 * Twitter fetch — fixtures + injectable HTTP (#954).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fetchTwitterContent } from "./fetch.js";
import { syndicationTweetResultUrl } from "./syndication-token.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

function textResponse(
  body: string,
  init: { status?: number; url?: string; contentType?: string } = {},
): Response {
  const response = new Response(body, {
    status: init.status ?? 200,
    headers: {
      "content-type": init.contentType ?? "text/html; charset=utf-8",
    },
  });
  if (init.url) {
    Object.defineProperty(response, "url", {
      value: init.url,
      configurable: true,
    });
  }
  return response;
}

describe("fetchTwitterContent (#954)", () => {
  it("loads status from syndication fixture", async () => {
    const body = readFixture("status-syndication.json");
    const result = await fetchTwitterContent(
      "https://x.com/jack/status/20",
      {
        fetchImpl: async (input) => {
          const url = String(input);
          if (url.startsWith("https://cdn.syndication.twimg.com/tweet-result")) {
            return textResponse(body, {
              contentType: "application/json",
            });
          }
          throw new Error(`unexpected URL: ${url}`);
        },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.kind).toBe("status");
    expect(result.value.contentId).toBe("20");
    expect(result.value.text).toContain("just setting up my twttr");
    expect(result.value.authorUsername).toBe("jack");
    expect(result.value.media).toEqual([
      {
        kind: "image",
        url: "https://pbs.twimg.com/media/fixture-status.jpg",
      },
    ]);
  });

  it("loads text-only status without media", async () => {
    const body = readFixture("status-text-only.json");
    const result = await fetchTwitterContent("20", {
      fetchImpl: async (input) => {
        const url = String(input);
        expect(url).toBe(syndicationTweetResultUrl("20"));
        return textResponse(body, { contentType: "application/json" });
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.media).toEqual([]);
    expect(result.value.text).toBe("just setting up my twttr");
  });

  it("loads article HTML with full text", async () => {
    const html = readFixture("article-page.html");
    const result = await fetchTwitterContent(
      "https://x.com/writer/article/ArtId01",
      {
        fetchImpl: async (input) => {
          const url = String(input);
          expect(url).toContain("/article/ArtId01");
          return textResponse(html);
        },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.kind).toBe("article");
    expect(result.value.contentId).toBe("ArtId01");
    expect(result.value.title).toBe("Deep dive into notes");
    expect(result.value.text).toContain("Paragraph two with more detail");
    expect(result.value.media[0]?.url).toContain("fixture-article.jpg");
  });

  it("resolves t.co to status then syndication", async () => {
    const redirect = readFixture("tco-redirect.html");
    const status = readFixture("status-syndication.json");
    const result = await fetchTwitterContent("https://t.co/AbCdEfGh", {
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("t.co/AbCdEfGh")) {
          return textResponse(redirect, {
            url: "https://x.com/jack/status/20",
          });
        }
        if (url.startsWith("https://cdn.syndication.twimg.com/tweet-result")) {
          return textResponse(status, { contentType: "application/json" });
        }
        throw new Error(`unexpected URL: ${url}`);
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.contentId).toBe("20");
  });

  it("returns login_wall for wall fixture on article", async () => {
    const wall = readFixture("login-wall.html");
    const result = await fetchTwitterContent(
      "https://x.com/writer/article/Secret99",
      {
        fetchImpl: async () => textResponse(wall, { status: 200 }),
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("login_wall");
  });

  it("parses article even when page includes login chrome", async () => {
    const html = [
      "<!DOCTYPE html><html><head>",
      '<meta property="og:title" content="How to Recursively Improve Your Agents" />',
      '<meta property="og:description" content="Short teaser only" />',
      '<meta property="og:image" content="https://pbs.twimg.com/media/MUST-NOT-USE-OG.jpg" />',
      "<title>Log in to X</title></head><body>",
      "<h1>Log in</h1><p>Sign up or log in to continue. Create your account today.</p>",
      '<article class="mx-auto">',
      "<h1>How to Recursively Improve Your Agents</h1>",
      "<p>Today I'm going to show you how to recursively improve your agents.</p>",
      "<p>Paragraph two with more detail about probes.</p>",
      "</article>",
      'media_entities:$R[10]=[$R[11]={media_id:"111",media_info:$R[12]={__typename:"ApiImage",alt_text:null,original_img_url:"https://pbs.twimg.com/media/HOzoCPxWYAAR8eX.jpg"}},$R[13]={media_id:"222",media_info:$R[14]={__typename:"ApiVideo",preview_image:$R[15]={alt_text:null,original_img_url:"https://pbs.twimg.com/amplify_video_thumb/1/img/x.jpg"},variants:$R[16]=[$R[17]={bit_rate:832000,content_type:"video/mp4",url:"https://video.twimg.com/amplify_video/1/vid/avc1/500x360/a.mp4"},$R[18]={bit_rate:2176000,content_type:"video/mp4",url:"https://video.twimg.com/amplify_video/1/vid/avc1/1000x720/b.mp4"}]}}]',
      "</body></html>",
    ].join("\n");
    const result = await fetchTwitterContent(
      "https://x.com/ashpreetbedi/article/2084301728363462919",
      {
        fetchImpl: async () => textResponse(html),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.kind).toBe("article");
    expect(result.value.title).toBe("How to Recursively Improve Your Agents");
    expect(result.value.text).toContain("Paragraph two with more detail");
    expect(result.value.media.map((m) => m.url)).toEqual([
      "https://pbs.twimg.com/media/HOzoCPxWYAAR8eX.jpg",
      "https://video.twimg.com/amplify_video/1/vid/avc1/1000x720/b.mp4",
    ]);
    expect(result.value.media.map((m) => m.url).join(" ")).not.toContain(
      "MUST-NOT-USE-OG",
    );
  });

  it("returns not_found when syndication 404s and page is login shell", async () => {
    const wall = readFixture("login-wall.html");
    const result = await fetchTwitterContent(
      "https://x.com/nobody/status/999888777666555444",
      {
        fetchImpl: async (input) => {
          const url = String(input);
          if (url.startsWith("https://cdn.syndication.twimg.com/tweet-result")) {
            return textResponse("<html class=dog>not found</html>", {
              status: 404,
            });
          }
          if (url.includes("/status/")) {
            return textResponse(wall, { status: 200 });
          }
          throw new Error(`unexpected URL: ${url}`);
        },
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    // Must not surface login_wall from the useless SPA shell.
    expect(result.code).toBe("not_found");
  });

  it("rejects invalid URLs", async () => {
    const result = await fetchTwitterContent("https://x.com/jack", {
      fetchImpl: async () => {
        throw new Error("must not fetch");
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("invalid_url");
  });
});
