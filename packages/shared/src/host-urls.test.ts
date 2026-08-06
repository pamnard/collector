import { describe, expect, it } from "vitest";
import { buildHostMediaFileUrl, deriveWsEventsUrl } from "./host-urls.js";

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

  it("deriveWsEventsUrl maps http and https", () => {
    expect(deriveWsEventsUrl("http://127.0.0.1:9")).toBe(
      "ws://127.0.0.1:9/api/events",
    );
    expect(deriveWsEventsUrl("https://example.test/")).toBe(
      "wss://example.test/api/events",
    );
  });
});
