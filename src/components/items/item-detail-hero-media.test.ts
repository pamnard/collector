import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { itemDetailHeroImgClassName } from "./item-detail-hero-media.ts";

describe("itemDetailHeroImgClassName", () => {
  it("expanded uses in-flow full height (h-auto), not a cropped fill box", () => {
    const classes = itemDetailHeroImgClassName(true);
    assert.match(classes, /\bh-auto\b/);
    assert.match(classes, /\bw-full\b/);
    assert.doesNotMatch(classes, /\babsolute\b/);
    assert.doesNotMatch(classes, /\bobject-cover\b/);
    assert.doesNotMatch(classes, /\bobject-contain\b/);
  });

  it("collapsed fills the 16:9 AspectRatio box with object-cover", () => {
    const classes = itemDetailHeroImgClassName(false);
    assert.match(classes, /\babsolute\b/);
    assert.match(classes, /\binset-0\b/);
    assert.match(classes, /\bobject-cover\b/);
    assert.doesNotMatch(classes, /\bh-auto\b/);
  });
});
