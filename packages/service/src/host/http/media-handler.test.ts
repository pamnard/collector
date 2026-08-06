/**
 * Unit tests for media path / Range helpers (#553).
 */

import { describe, expect, it } from "vitest";
import {
  contentTypeForPath,
  isResolvedPathInsideVaults,
  parseByteRange,
} from "./media-handler.js";

describe("media-handler helpers (#553)", () => {
  it("isResolvedPathInsideVaults requires a path under the root", () => {
    expect(
      isResolvedPathInsideVaults("/data/vaults", "/data/vaults/a/cover.webp"),
    ).toBe(true);
    expect(isResolvedPathInsideVaults("/data/vaults", "/data/vaults")).toBe(
      false,
    );
    expect(
      isResolvedPathInsideVaults("/data/vaults", "/data/outside/cover.webp"),
    ).toBe(false);
    expect(
      isResolvedPathInsideVaults("/data/vaults", "/data/vaults-evil/x"),
    ).toBe(false);
  });

  it("parseByteRange handles start-end and suffix forms", () => {
    expect(parseByteRange("bytes=0-3", 10)).toEqual({ start: 0, end: 3 });
    expect(parseByteRange("bytes=8-", 10)).toEqual({ start: 8, end: 9 });
    expect(parseByteRange("bytes=-4", 10)).toEqual({ start: 6, end: 9 });
    expect(parseByteRange("bytes=0-3", 0)).toBeNull();
    expect(parseByteRange(undefined, 10)).toBeNull();
  });

  it("contentTypeForPath maps known extensions", () => {
    expect(contentTypeForPath("/a/cover.webp")).toBe("image/webp");
    expect(contentTypeForPath("/a/clip.mp4")).toBe("video/mp4");
    expect(contentTypeForPath("/a/unknown.bin")).toBe(
      "application/octet-stream",
    );
  });
});
