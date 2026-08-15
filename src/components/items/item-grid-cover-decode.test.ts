import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPortraitNaturalSize,
  planItemGridCoverDecode,
} from "./item-grid-cover-decode.ts";

describe("planItemGridCoverDecode", () => {
  it("waits while the cover path is still resolving", () => {
    assert.deepEqual(
      planItemGridCoverDecode({
        thumbnailPath: undefined,
        resolvedSrc: null,
        shouldDecode: true,
        currentSrc: null,
        currentSettled: false,
      }),
      { kind: "wait-path" },
    );
  });

  it("settles empty when there is no cover src", () => {
    assert.deepEqual(
      planItemGridCoverDecode({
        thumbnailPath: null,
        resolvedSrc: null,
        shouldDecode: true,
        currentSrc: null,
        currentSettled: false,
      }),
      { kind: "settled-empty" },
    );
  });

  it("defers decode for offscreen cards with a known src", () => {
    assert.deepEqual(
      planItemGridCoverDecode({
        thumbnailPath: "/thumb.webp",
        resolvedSrc: "/cover.jpg",
        shouldDecode: false,
        currentSrc: null,
        currentSettled: false,
      }),
      { kind: "defer", src: "/cover.jpg" },
    );
  });

  it("starts decode when near viewport", () => {
    assert.deepEqual(
      planItemGridCoverDecode({
        thumbnailPath: "/thumb.webp",
        resolvedSrc: "/cover.jpg",
        shouldDecode: true,
        currentSrc: null,
        currentSettled: false,
      }),
      { kind: "decode", src: "/cover.jpg" },
    );
  });

  it("skips when the same src is already settled", () => {
    assert.deepEqual(
      planItemGridCoverDecode({
        thumbnailPath: "/thumb.webp",
        resolvedSrc: "/cover.jpg",
        shouldDecode: true,
        currentSrc: "/cover.jpg",
        currentSettled: true,
      }),
      { kind: "wait-path" },
    );
  });
});

describe("isPortraitNaturalSize", () => {
  it("treats tall covers as portrait", () => {
    const img = {
      naturalWidth: 100,
      naturalHeight: 200,
    } as HTMLImageElement;
    assert.equal(isPortraitNaturalSize(img), true);
  });

  it("treats wide covers as landscape", () => {
    const img = {
      naturalWidth: 200,
      naturalHeight: 100,
    } as HTMLImageElement;
    assert.equal(isPortraitNaturalSize(img), false);
  });
});
