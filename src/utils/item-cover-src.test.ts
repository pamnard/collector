import { describe, expect, it } from "vitest";
import { resolveCoverSrc } from "./item-cover-src";

describe("resolveCoverSrc (#739)", () => {
  it("maps a resolved disk path through toDisplayAssetSrc", () => {
    expect(resolveCoverSrc("/vault/media/id/cover.webp")).toBe(
      "/vault/media/id/cover.webp",
    );
  });

  it("returns null when path is null (no YouTube CDN fallback)", () => {
    expect(resolveCoverSrc(null)).toBeNull();
  });
});
