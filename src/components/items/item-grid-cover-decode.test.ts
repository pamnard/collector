import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPortraitNaturalSize,
  planItemGridCoverDecode,
  readDomImgDecodeState,
  settleDomImgCoverDecode,
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

  it("keeps settled cover when scrolling out of the near zone", () => {
    assert.deepEqual(
      planItemGridCoverDecode({
        thumbnailPath: "/thumb.webp",
        resolvedSrc: "/cover.jpg",
        shouldDecode: false,
        currentSrc: "/cover.jpg",
        currentSettled: true,
      }),
      { kind: "wait-path" },
    );
  });

  it("does not abort in-flight decode when leaving the near zone", () => {
    assert.deepEqual(
      planItemGridCoverDecode({
        thumbnailPath: "/thumb.webp",
        resolvedSrc: "/cover.jpg",
        shouldDecode: false,
        currentSrc: "/cover.jpg",
        currentSettled: false,
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

describe("readDomImgDecodeState", () => {
  it("is pending while the browser has not completed the load", () => {
    assert.equal(
      readDomImgDecodeState({ complete: false, naturalWidth: 0 }),
      "pending",
    );
  });

  it("is loaded for a complete image with dimensions", () => {
    assert.equal(
      readDomImgDecodeState({ complete: true, naturalWidth: 120 }),
      "loaded",
    );
  });

  it("is broken when complete with naturalWidth 0 (cached error)", () => {
    assert.equal(
      readDomImgDecodeState({ complete: true, naturalWidth: 0 }),
      "broken",
    );
  });
});

describe("settleDomImgCoverDecode", () => {
  it("does nothing while pending", () => {
    let loads = 0;
    let errors = 0;
    const settled = settleDomImgCoverDecode(
      { complete: false, naturalWidth: 0 } as HTMLImageElement,
      {
        onLoad: () => {
          loads += 1;
        },
        onError: () => {
          errors += 1;
        },
      },
    );
    assert.equal(settled, false);
    assert.equal(loads, 0);
    assert.equal(errors, 0);
  });

  it("routes complete cached images through the load settle path", () => {
    const img = {
      complete: true,
      naturalWidth: 80,
      naturalHeight: 120,
      currentSrc: "file:///cover.webp",
      src: "file:///cover.webp",
    } as HTMLImageElement;
    let loaded: HTMLImageElement | null = null;
    const settled = settleDomImgCoverDecode(img, {
      onLoad: (el) => {
        loaded = el;
      },
      onError: () => {
        assert.fail("expected load path");
      },
    });
    assert.equal(settled, true);
    assert.equal(loaded, img);
  });

  it("routes complete naturalWidth 0 through the error settle path", () => {
    let errors = 0;
    const settled = settleDomImgCoverDecode(
      { complete: true, naturalWidth: 0 } as HTMLImageElement,
      {
        onLoad: () => {
          assert.fail("expected error path");
        },
        onError: () => {
          errors += 1;
        },
      },
    );
    assert.equal(settled, true);
    assert.equal(errors, 1);
  });
});
