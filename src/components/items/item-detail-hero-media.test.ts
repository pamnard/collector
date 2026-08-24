import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DETAIL_HERO_ASPECT_RATIO,
  DETAIL_HERO_MEDIA_HEIGHT,
  DETAIL_HERO_MEDIA_WIDTH,
  itemDetailHeroImgClassName,
} from "./item-detail-hero-media.ts";

describe("item-detail-hero-media", () => {
  it("reserves a stable 16:9 box from explicit media dimensions", () => {
    assert.equal(DETAIL_HERO_MEDIA_WIDTH, 1600);
    assert.equal(DETAIL_HERO_MEDIA_HEIGHT, 900);
    assert.equal(DETAIL_HERO_ASPECT_RATIO, 16 / 9);
  });

  it("fills the reserved box with cover when collapsed", () => {
    const className = itemDetailHeroImgClassName(false);
    assert.match(className, /\babsolute\b/);
    assert.match(className, /\binset-0\b/);
    assert.match(className, /\bh-full\b/);
    assert.match(className, /\bw-full\b/);
    assert.match(className, /\bobject-cover\b/);
    assert.doesNotMatch(className, /\bh-auto\b/);
    assert.doesNotMatch(className, /\bobject-contain\b/);
  });

  it("fills the reserved box with contain when expanded (no intrinsic h-auto)", () => {
    const className = itemDetailHeroImgClassName(true);
    assert.match(className, /\bobject-contain\b/);
    assert.doesNotMatch(className, /\bh-auto\b/);
    assert.doesNotMatch(className, /\bobject-cover\b/);
  });
});
