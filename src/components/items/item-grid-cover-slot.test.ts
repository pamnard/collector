import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  itemGridCoverImgClassName,
  itemGridCoverImgSizeAttrs,
  itemGridCoverPixelSizeFromImg,
  itemGridCoverSlot,
  itemGridCoverSlotAspectStyle,
} from "./item-grid-cover-slot.ts";

describe("itemGridCoverSlot", () => {
  it("shows pending only while a cover attempt is in flight", () => {
    assert.deepEqual(
      itemGridCoverSlot({
        expectedCoverSrc: "/cover.jpg",
        coverSrc: null,
        coverSettled: false,
      }),
      { coverPending: true, showCover: false, loadCover: false },
    );
  });

  it("hides the teaser after a failed or timed-out cover decode", () => {
    assert.deepEqual(
      itemGridCoverSlot({
        expectedCoverSrc: "/missing.jpg",
        coverSrc: null,
        coverSettled: true,
      }),
      { coverPending: false, showCover: false, loadCover: false },
    );
  });

  it("shows the cover only after a successful settle", () => {
    assert.deepEqual(
      itemGridCoverSlot({
        expectedCoverSrc: "/cover.jpg",
        coverSrc: "/cover.jpg",
        coverSettled: true,
      }),
      { coverPending: false, showCover: true, loadCover: false },
    );
  });

  it("loads the cover img while decode is in flight", () => {
    assert.deepEqual(
      itemGridCoverSlot({
        expectedCoverSrc: "/cover.jpg",
        coverSrc: "/cover.jpg",
        coverSettled: false,
      }),
      { coverPending: true, showCover: false, loadCover: true },
    );
  });

  it("never reserves a teaser when there is no expected cover", () => {
    assert.deepEqual(
      itemGridCoverSlot({
        expectedCoverSrc: null,
        coverSrc: null,
        coverSettled: false,
      }),
      { coverPending: false, showCover: false, loadCover: false },
    );
  });

  it("does not treat pending alone as showCover (no optimistic chrome)", () => {
    const pending = itemGridCoverSlot({
      expectedCoverSrc: "/vault/media/id/cover.webp",
      coverSrc: "/vault/media/id/cover.webp",
      coverSettled: false,
    });
    assert.equal(pending.showCover, false);
    assert.equal(pending.loadCover, true);
  });
});

describe("itemGridCoverPixelSizeFromImg", () => {
  it("reads positive natural dimensions for reservation", () => {
    assert.deepEqual(
      itemGridCoverPixelSizeFromImg({ naturalWidth: 480, naturalHeight: 320 }),
      { width: 480, height: 320 },
    );
  });

  it("rejects non-positive natural dimensions", () => {
    assert.throws(
      () => itemGridCoverPixelSizeFromImg({ naturalWidth: 0, naturalHeight: 100 }),
      /positive/,
    );
    assert.throws(
      () => itemGridCoverPixelSizeFromImg({ naturalWidth: 100, naturalHeight: 0 }),
      /positive/,
    );
  });
});

describe("itemGridCoverImgSizeAttrs", () => {
  it("exposes explicit width/height attrs for unsized-images", () => {
    assert.deepEqual(itemGridCoverImgSizeAttrs({ width: 400, height: 300 }), {
      width: 400,
      height: 300,
    });
  });
});

describe("itemGridCoverSlotAspectStyle", () => {
  it("reserves layout via CSS aspect-ratio from pixel size", () => {
    assert.deepEqual(itemGridCoverSlotAspectStyle({ width: 480, height: 640 }), {
      aspectRatio: "480 / 640",
    });
  });
});

describe("itemGridCoverImgClassName", () => {
  it("takes the in-flight cover img out of layout flow", () => {
    const classes = itemGridCoverImgClassName({ loadCover: true });
    assert.match(classes, /\babsolute\b/);
    assert.match(classes, /\bopacity-0\b/);
    // In-flow h-auto would stack with the aspect placeholder when dimensions are known.
    assert.doesNotMatch(classes, /\bh-auto\b/);
  });

  it("fills the reserved aspect slot instead of owning height via h-auto alone", () => {
    const classes = itemGridCoverImgClassName({ loadCover: false });
    assert.match(classes, /\babsolute\b/);
    assert.match(classes, /\binset-0\b/);
    assert.match(classes, /\bh-full\b/);
    assert.match(classes, /\bw-full\b/);
    assert.doesNotMatch(classes, /\bh-auto\b/);
    assert.doesNotMatch(classes, /\bopacity-0\b/);
  });
});
