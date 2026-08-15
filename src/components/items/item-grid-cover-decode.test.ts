import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COVER_DECODE_ROOT_MARGIN,
  ITEM_GRID_COVER_IMG_LOADING,
  shouldProbeCoverPixels,
  shouldSettleCoverWithoutProbe,
} from "./item-grid-cover-decode.ts";

describe("shouldProbeCoverPixels", () => {
  it("does not probe offscreen cards even when a cover src is known", () => {
    assert.equal(
      shouldProbeCoverPixels({
        nearViewport: false,
        coverSrc: "/covers/a.jpg",
      }),
      false,
    );
  });

  it("probes only near-viewport cards with a concrete cover src", () => {
    assert.equal(
      shouldProbeCoverPixels({
        nearViewport: true,
        coverSrc: "/covers/a.jpg",
      }),
      true,
    );
  });

  it("never probes when there is no cover src", () => {
    assert.equal(
      shouldProbeCoverPixels({
        nearViewport: true,
        coverSrc: null,
      }),
      false,
    );
  });
});

describe("shouldSettleCoverWithoutProbe", () => {
  it("waits while the cover path is still resolving", () => {
    assert.equal(
      shouldSettleCoverWithoutProbe({
        thumbnailPath: undefined,
        coverSrc: null,
      }),
      false,
    );
  });

  it("settles immediately when the path is known and there is no cover to decode", () => {
    assert.equal(
      shouldSettleCoverWithoutProbe({
        thumbnailPath: null,
        coverSrc: null,
      }),
      true,
    );
  });

  it("does not settle-without-probe when pixels still need decode", () => {
    assert.equal(
      shouldSettleCoverWithoutProbe({
        thumbnailPath: "/disk/cover.jpg",
        coverSrc: "/asset/cover.jpg",
      }),
      false,
    );
  });
});

describe("item grid cover display loading", () => {
  it("never uses eager loading on the display img (Image() owns decode)", () => {
    assert.equal(ITEM_GRID_COVER_IMG_LOADING, "lazy");
    assert.notEqual(ITEM_GRID_COVER_IMG_LOADING, "eager");
  });

  it("keeps a near-viewport rootMargin for cover decode priority", () => {
    assert.match(COVER_DECODE_ROOT_MARGIN, /^\d+px$/);
    const px = Number(COVER_DECODE_ROOT_MARGIN.replace("px", ""));
    assert.ok(px >= 240, "decode margin should be at least infinite-scroll margin");
  });
});
