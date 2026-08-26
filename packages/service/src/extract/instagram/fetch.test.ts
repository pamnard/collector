import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fetchInstagramMedia } from "./fetch.js";
import { parseInstagramTarget } from "./url.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

function textResponse(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...init.headers,
    },
  });
}

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

describe("parseInstagramTarget", () => {
  it("parses post / reel / tv URLs and bare shortcodes", () => {
    expect(parseInstagramTarget("https://www.instagram.com/p/CxImage01ab/")).toEqual({
      shortcode: "CxImage01ab",
      sourceUrl: "https://www.instagram.com/p/CxImage01ab/",
    });
    expect(
      parseInstagramTarget("https://instagram.com/reel/CzReelVid3ef/?igsh=1"),
    ).toEqual({
      shortcode: "CzReelVid3ef",
      sourceUrl: "https://www.instagram.com/reel/CzReelVid3ef/",
    });
    expect(parseInstagramTarget("CzReelVid3ef")).toEqual({
      shortcode: "CzReelVid3ef",
      sourceUrl: "https://www.instagram.com/p/CzReelVid3ef/",
    });
  });

  it("rejects stories, profiles, and non-Instagram URLs", () => {
    expect(
      parseInstagramTarget("https://www.instagram.com/stories/user/123/"),
    ).toBeNull();
    expect(parseInstagramTarget("https://www.instagram.com/fixture_user/")).toBeNull();
    expect(parseInstagramTarget("https://example.com/p/CxImage01ab/")).toBeNull();
  });
});

describe("fetchInstagramMedia (#847)", () => {
  it("returns invalid_url for unsupported input", async () => {
    const result = await fetchInstagramMedia("https://example.com/x", {
      fetchImpl: async () => {
        throw new Error("fetch must not be called for invalid_url");
      },
    });
    expect(result).toEqual({
      ok: false,
      code: "invalid_url",
      message: expect.stringContaining("Not a supported Instagram"),
    });
  });

  it("fetches a single image post from embed contextJSON", async () => {
    const embed = readFixture("single-image-embed.html");
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/p/CxImage01ab/embed/")) {
        return textResponse(embed);
      }
      throw new Error(`unexpected URL in single-image test: ${url}`);
    };

    const result = await fetchInstagramMedia(
      "https://www.instagram.com/p/CxImage01ab/",
      { fetchImpl },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected success");
    }
    expect(result.value).toEqual({
      sourceUrl: "https://www.instagram.com/p/CxImage01ab/",
      shortcode: "CxImage01ab",
      authorUsername: "fixture_user",
      caption: "Morning ride\n#bike",
      accessibilityCaption: "A red bicycle parked by a brick wall",
      media: [
        {
          kind: "image",
          url: "https://cdn.instagram.fixture/single.jpg",
          suggestedFilename: "CxImage01ab.jpg",
        },
      ],
    });
  });

  it("fetches carousel items (image + video + image)", async () => {
    const embed = readFixture("carousel-embed.html");
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/p/CyCarous2cd/embed/")) {
        return textResponse(embed);
      }
      throw new Error(`unexpected URL in carousel test: ${url}`);
    };

    const result = await fetchInstagramMedia(
      "https://www.instagram.com/p/CyCarous2cd/",
      { fetchImpl },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected success");
    }
    expect(result.value.authorUsername).toBe("carousel_owner");
    expect(result.value.caption).toBe("Trip album");
    expect(result.value.accessibilityCaption).toBeNull();
    expect(result.value.media).toEqual([
      {
        kind: "image",
        url: "https://cdn.instagram.fixture/carousel-1.jpg",
        suggestedFilename: "CyCarous2cd_1.jpg",
      },
      {
        kind: "video",
        url: "https://cdn.instagram.fixture/carousel-2.mp4",
        suggestedFilename: "CyCarous2cd_2.mp4",
      },
      {
        kind: "image",
        url: "https://cdn.instagram.fixture/carousel-3.jpg",
        suggestedFilename: "CyCarous2cd_3.jpg",
      },
    ]);
  });

  it("fetches reel video URL via Polaris after cover-only embed", async () => {
    const coverEmbed = readFixture("reel-cover-only-embed.html");
    const homepage = readFixture("polaris-homepage.html");
    const ruling = JSON.parse(readFixture("polaris-ruling.json")) as unknown;
    const polaris = JSON.parse(
      readFixture("polaris-reel-graphql.json"),
    ) as unknown;

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/p/CzReelVid3ef/embed/")) {
        return textResponse(coverEmbed);
      }
      if (url === "https://www.instagram.com/" || url === "https://www.instagram.com") {
        return textResponse(homepage, {
          headers: {
            "set-cookie": "csrftoken=fixture_csrf; Path=/; Secure",
          },
        });
      }
      if (url.includes("/web/get_ruling_for_content/")) {
        return jsonResponse(ruling);
      }
      if (url.includes("/api/graphql") && init?.method === "POST") {
        return jsonResponse(polaris);
      }
      throw new Error(`unexpected URL in reel test: ${url}`);
    };

    const result = await fetchInstagramMedia(
      "https://www.instagram.com/reel/CzReelVid3ef/",
      { fetchImpl },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected success");
    }
    expect(result.value.sourceUrl).toBe(
      "https://www.instagram.com/reel/CzReelVid3ef/",
    );
    expect(result.value.shortcode).toBe("CzReelVid3ef");
    expect(result.value.authorUsername).toBe("reel_creator");
    expect(result.value.caption).toBe("Skate clip");
    expect(result.value.accessibilityCaption).toBeNull();
    expect(result.value.media).toEqual([
      {
        kind: "video",
        url: "https://cdn.instagram.fixture/reel.mp4",
        suggestedFilename: "CzReelVid3ef.mp4",
      },
    ]);
  });

  it("returns login_wall when every layer hits a login wall", async () => {
    const loginWall = readFixture("login-wall-embed.html");
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/embed/")) {
        return textResponse(loginWall);
      }
      if (url === "https://www.instagram.com/" || url === "https://www.instagram.com") {
        return textResponse(loginWall, {
          headers: { "set-cookie": "csrftoken=fixture_csrf; Path=/" },
        });
      }
      if (url.includes("/web/get_ruling_for_content/")) {
        return jsonResponse(
          { status: "fail", title: "login_required" },
          { status: 200 },
        );
      }
      if (url.includes("/graphql/query/")) {
        return textResponse(loginWall, { status: 403 });
      }
      if (url.includes("/p/") && !url.includes("/embed/")) {
        return textResponse(loginWall);
      }
      if (url.includes("/api/v1/media/")) {
        return jsonResponse({ message: "login_required" }, { status: 403 });
      }
      if (url.includes("/api/graphql")) {
        return jsonResponse({ data: { xig_polaris_media: {} } });
      }
      throw new Error(`unexpected URL in login-wall test: ${url}`);
    };

    const result = await fetchInstagramMedia(
      "https://www.instagram.com/p/LoginWall1/",
      { fetchImpl },
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }
    expect(result.code).toBe("login_wall");
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("never fabricates accessibilityCaption when fixture omits it", async () => {
    const embed = readFixture("carousel-embed.html");
    const result = await fetchInstagramMedia("CyCarous2cd", {
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/embed/")) {
          return textResponse(embed);
        }
        throw new Error(`unexpected URL: ${url}`);
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected success");
    }
    expect(result.value.accessibilityCaption).toBeNull();
  });

  it("surfaces rate_limited without trying further layers after 429", async () => {
    let calls = 0;
    const result = await fetchInstagramMedia(
      "https://www.instagram.com/p/RateLimit1/",
      {
        fetchImpl: async () => {
          calls += 1;
          return textResponse("slow down", { status: 429 });
        },
      },
    );
    expect(result).toEqual({
      ok: false,
      code: "rate_limited",
      message: expect.stringContaining("rate limited"),
    });
    expect(calls).toBe(1);
  });
});
