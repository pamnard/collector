import { describe, expect, it } from "vitest";
import { resolveCoverSrc } from "./item-cover-src";

describe("resolveCoverSrc", () => {
  it("prefers resolved thumbnail path over YouTube", () => {
    expect(
      resolveCoverSrc(
        "https://host/media/cover.webp",
        "https://www.youtube.com/watch?v=abcdefghijk",
      ),
    ).toBe("https://host/media/cover.webp");
  });

  it("falls back to YouTube when path is null", () => {
    expect(
      resolveCoverSrc(null, "https://www.youtube.com/watch?v=abcdefghijk"),
    ).toBe("https://img.youtube.com/vi/abcdefghijk/mqdefault.jpg");
  });

  it("returns null when neither path nor YouTube applies", () => {
    expect(resolveCoverSrc(null, "https://example.com")).toBeNull();
    expect(resolveCoverSrc(null, undefined)).toBeNull();
  });
});
