import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fetchPinterestPin } from "./fetch.js";
import { parsePinterestTarget } from "./url.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

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
  body: unknown,
  init: { status?: number } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

describe("parsePinterestTarget (#34)", () => {
  it("parses pin URLs, bare ids, and pin.it", () => {
    expect(parsePinterestTarget("https://www.pinterest.com/pin/111222333444/")).toEqual({
      kind: "pin",
      pinId: "111222333444",
      sourceUrl: "https://www.pinterest.com/pin/111222333444/",
    });
    expect(parsePinterestTarget("111222333444")).toEqual({
      kind: "pin",
      pinId: "111222333444",
      sourceUrl: "https://www.pinterest.com/pin/111222333444/",
    });
    expect(parsePinterestTarget("https://pin.it/1uTuGaTJV")).toEqual({
      kind: "pinit",
      code: "1uTuGaTJV",
      sourceUrl: "https://pin.it/1uTuGaTJV",
    });
  });

  it("rejects boards and non-Pinterest", () => {
    expect(parsePinterestTarget("https://www.pinterest.com/user/board/")).toBeNull();
    expect(parsePinterestTarget("https://example.com/pin/111/")).toBeNull();
  });
});

describe("fetchPinterestPin (#34)", () => {
  it("returns invalid_url for unsupported input", async () => {
    const result = await fetchPinterestPin("https://example.com/x", {
      fetchImpl: async () => {
        throw new Error("fetch must not be called for invalid_url");
      },
    });
    expect(result).toEqual({
      ok: false,
      code: "invalid_url",
      message: expect.stringContaining("Not a supported Pinterest"),
    });
  });

  it("fetches a single image pin from HTML __PWS_DATA__", async () => {
    const html = readFixture("single-image-pin.html");
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/pin/111222333444/")) {
        return textResponse(html);
      }
      throw new Error(`unexpected URL in single-image test: ${url}`);
    };

    const result = await fetchPinterestPin(
      "https://www.pinterest.com/pin/111222333444/",
      { fetchImpl },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected success");
    }
    expect(result.value).toEqual({
      sourceUrl: "https://www.pinterest.com/pin/111222333444/",
      pinId: "111222333444",
      authorUsername: "fixture_user",
      title: "Morning ride",
      description: "Morning ride\n#bike",
      media: [
        {
          kind: "image",
          url: "https://cdn.pinterest.fixture/single.jpg",
        },
      ],
    });
  });

  it("falls back to PinResource when HTML has no media", async () => {
    const resource = JSON.parse(readFixture("pin-resource-video.json"));
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/pin/555666777888/") && !url.includes("PinResource")) {
        return textResponse("<html><body>empty shell</body></html>");
      }
      if (url.includes("PinResource") && url.includes("555666777888")) {
        return jsonResponse(resource);
      }
      throw new Error(`unexpected URL in pin-resource test: ${url}`);
    };

    const result = await fetchPinterestPin("555666777888", { fetchImpl });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected success");
    }
    expect(result.value.pinId).toBe("555666777888");
    expect(result.value.media).toEqual([
      {
        kind: "video",
        url: "https://cdn.pinterest.fixture/carousel.mp4",
      },
    ]);
  });

  it("resolves pin.it then loads the pin page", async () => {
    const html = readFixture("single-image-pin.html");
    const redirect = readFixture("pinit-redirect.html");
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url === "https://pin.it/AbCdEf12") {
        return textResponse(redirect, {
          url: "https://www.pinterest.com/pin/111222333444/",
        });
      }
      if (url.includes("/pin/111222333444/")) {
        return textResponse(html);
      }
      throw new Error(`unexpected URL in pin.it test: ${url}`);
    };

    const result = await fetchPinterestPin("https://pin.it/AbCdEf12", {
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected success");
    }
    expect(result.value.pinId).toBe("111222333444");
  });

  it("returns login_wall when layers only yield auth chrome", async () => {
    const wall = readFixture("login-wall.html");
    const fetchImpl: typeof fetch = async () => textResponse(wall, { status: 403 });

    const result = await fetchPinterestPin(
      "https://www.pinterest.com/pin/999999999999/",
      { fetchImpl },
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }
    expect(["login_wall", "private_or_unavailable"]).toContain(result.code);
  });
});
