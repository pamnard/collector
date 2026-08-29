import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  itemGridCoverImgClassName,
  itemGridCoverImgSizeAttrs,
  itemGridCoverLayoutPhase,
  itemGridCoverOverlayLayout,
  itemGridCoverPixelSizeFromImg,
  itemGridCoverPulseClassName,
  itemGridCoverSlot,
  itemGridCoverSlotAspectStyle,
  itemGridCoverSlotPending,
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
});

describe("itemGridCoverSlotPending", () => {
  it("reserves only when pending and host gave exact WxH", () => {
    assert.equal(
      itemGridCoverSlotPending({
        coverPending: true,
        resolvedPixelSize: { width: 400, height: 300 },
      }),
      true,
    );
  });

  it("does not reserve without pixel size (no fake 16:9/3:4)", () => {
    assert.equal(
      itemGridCoverSlotPending({
        coverPending: true,
        resolvedPixelSize: undefined,
      }),
      false,
    );
    assert.equal(
      itemGridCoverSlotPending({
        coverPending: true,
        resolvedPixelSize: null,
      }),
      false,
    );
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
    assert.match(classes, /\btransition-opacity\b/);
    assert.doesNotMatch(classes, /\bh-auto\b/);
  });

  it("fills the reserved aspect slot instead of owning height via h-auto alone", () => {
    const classes = itemGridCoverImgClassName({ loadCover: false });
    assert.match(classes, /\babsolute\b/);
    assert.match(classes, /\binset-0\b/);
    assert.match(classes, /\bh-full\b/);
    assert.match(classes, /\bw-full\b/);
    assert.match(classes, /\bopacity-100\b/);
    assert.match(classes, /\btransition-opacity\b/);
    assert.doesNotMatch(classes, /\bh-auto\b/);
  });
});

describe("itemGridCoverPulseClassName", () => {
  it("pulses while the cover is not yet painted", () => {
    const classes = itemGridCoverPulseClassName({ visible: true });
    assert.match(classes, /\banimate-pulse\b/);
    assert.match(classes, /\bopacity-100\b/);
    assert.match(classes, /\btransition-opacity\b/);
  });

  it("fades out without pulse once the cover is painted", () => {
    const classes = itemGridCoverPulseClassName({ visible: false });
    assert.match(classes, /\bopacity-0\b/);
    assert.doesNotMatch(classes, /\banimate-pulse\b/);
  });
});

describe("itemGridCoverOverlayLayout", () => {
  it("uses reserved WxH so portrait chrome is stable before decode", () => {
    assert.equal(
      itemGridCoverOverlayLayout({
        hasCover: true,
        slotSize: { width: 421, height: 610 },
      }),
      true,
    );
  });

  it("keeps square and landscape meta below the cover", () => {
    assert.equal(
      itemGridCoverOverlayLayout({
        hasCover: true,
        slotSize: { width: 736, height: 736 },
      }),
      false,
    );
    assert.equal(
      itemGridCoverOverlayLayout({
        hasCover: true,
        slotSize: { width: 800, height: 400 },
      }),
      false,
    );
  });

  it("stays off without a cover slot", () => {
    assert.equal(
      itemGridCoverOverlayLayout({
        hasCover: false,
        slotSize: { width: 421, height: 610 },
      }),
      false,
    );
    assert.equal(
      itemGridCoverOverlayLayout({ hasCover: true, slotSize: null }),
      false,
    );
  });
});

describe("itemGridCoverLayoutPhase (#799)", () => {
  it("waits while path is still resolving", () => {
    assert.equal(
      itemGridCoverLayoutPhase({
        thumbnailPath: undefined,
        resolvedPixelSize: null,
        coverSettled: false,
        coverSrc: null,
      }),
      "wait-path",
    );
  });

  it("is text-only when path is explicitly null", () => {
    assert.equal(
      itemGridCoverLayoutPhase({
        thumbnailPath: null,
        resolvedPixelSize: null,
        coverSettled: true,
        coverSrc: null,
      }),
      "text-only",
    );
  });

  it("reserves pending only when path and WxH are known before decode", () => {
    assert.equal(
      itemGridCoverLayoutPhase({
        thumbnailPath: "/cover.webp",
        resolvedPixelSize: { width: 400, height: 300 },
        coverSettled: false,
        coverSrc: "/cover.webp",
      }),
      "reserved-pending",
    );
  });

  it("does not reserve when path is known but WxH is missing (#799)", () => {
    assert.equal(
      itemGridCoverLayoutPhase({
        thumbnailPath: "/cover.webp",
        resolvedPixelSize: null,
        coverSettled: false,
        coverSrc: "/cover.webp",
      }),
      "wait-path",
    );
  });

  it("is cover-visible when settled with WxH", () => {
    assert.equal(
      itemGridCoverLayoutPhase({
        thumbnailPath: "/cover.webp",
        resolvedPixelSize: { width: 400, height: 300 },
        coverSettled: true,
        coverSrc: "/cover.webp",
      }),
      "cover-visible",
    );
  });
});
