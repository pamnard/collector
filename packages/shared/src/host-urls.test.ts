import { describe, expect, it } from "vitest";
import {
  buildHostMediaDeriveUrl,
  buildHostMediaFileUrl,
  deriveWsEventsUrl,
} from "./host-urls.js";

describe("host-urls (#550 E)", () => {
  it("buildHostMediaFileUrl encodes path and token", () => {
    const url = buildHostMediaFileUrl(
      "http://127.0.0.1:9",
      "tok",
      "/vault/a b.webp",
    );
    expect(url.startsWith("http://127.0.0.1:9/media/file?")).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("path")).toBe("/vault/a b.webp");
    expect(parsed.searchParams.get("token")).toBe("tok");
  });

  it("buildHostMediaDeriveUrl encodes path, whitelist w, and token (#882)", () => {
    const url = buildHostMediaDeriveUrl(
      "http://127.0.0.1:9",
      "tok",
      "/vault/a b.webp",
      640,
    );
    expect(url.startsWith("http://127.0.0.1:9/media/derive?")).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("path")).toBe("/vault/a b.webp");
    expect(parsed.searchParams.get("w")).toBe("640");
    expect(parsed.searchParams.get("token")).toBe("tok");
    expect(parsed.searchParams.get("v")).toBeNull();
  });

  it("buildHostMediaDeriveUrl includes v from sourceMtimeMs and changes when mtime changes", () => {
    const a = buildHostMediaDeriveUrl(
      "http://127.0.0.1:9",
      "tok",
      "/vault/a.webp",
      640,
      1_700_000_000_123.9,
    );
    const b = buildHostMediaDeriveUrl(
      "http://127.0.0.1:9",
      "tok",
      "/vault/a.webp",
      640,
      1_700_000_000_999,
    );
    expect(new URL(a).searchParams.get("v")).toBe("1700000000123");
    expect(new URL(b).searchParams.get("v")).toBe("1700000000999");
    expect(a).not.toBe(b);
  });

  it("buildHostMediaDeriveUrl rejects non-whitelist width", () => {
    expect(() =>
      buildHostMediaDeriveUrl("http://127.0.0.1:9", "tok", "/vault/a.webp", 123),
    ).toThrow(/whitelist/);
  });

  it("buildHostMediaDeriveUrl rejects invalid sourceMtimeMs", () => {
    expect(() =>
      buildHostMediaDeriveUrl(
        "http://127.0.0.1:9",
        "tok",
        "/vault/a.webp",
        640,
        Number.NaN,
      ),
    ).toThrow(/mtimeMs/);
  });

  it("deriveWsEventsUrl maps http and https", () => {
    expect(deriveWsEventsUrl("http://127.0.0.1:9")).toBe(
      "ws://127.0.0.1:9/api/events",
    );
    expect(deriveWsEventsUrl("https://example.test/")).toBe(
      "wss://example.test/api/events",
    );
  });
});
