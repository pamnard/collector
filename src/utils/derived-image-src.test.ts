import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { buildHostMediaDeriveUrl } from "@collector/shared";
import {
  clearHostMediaCredentials,
  setHostMediaCredentials,
} from "./asset-src.ts";
import {
  absolutePathForMediaDerive,
  buildDerivedImageAttrs,
} from "./derived-image-src.ts";

describe("derived-image-src (#882)", () => {
  afterEach(() => {
    clearHostMediaCredentials();
  });

  it("extracts vault path from media file/derive URLs", () => {
    assert.equal(
      absolutePathForMediaDerive("/vault/a/cover.webp"),
      "/vault/a/cover.webp",
    );
    const deriveUrl = buildHostMediaDeriveUrl(
      "http://127.0.0.1:9",
      "tok",
      "/vault/a/cover.webp",
      480,
    );
    assert.equal(absolutePathForMediaDerive(deriveUrl), "/vault/a/cover.webp");
    assert.equal(absolutePathForMediaDerive("blob:x"), null);
  });

  it("builds derive src + srcset when host credentials are set", () => {
    setHostMediaCredentials("http://127.0.0.1:9", "tok");
    const attrs = buildDerivedImageAttrs({
      displayPath: "/data/vaults/v1/media/id/cover.webp",
      slotCssWidthPx: 280,
      devicePixelRatio: 2,
    });
    assert.equal(attrs.sizes, "280px");
    assert.equal(
      attrs.src,
      buildHostMediaDeriveUrl(
        "http://127.0.0.1:9",
        "tok",
        "/data/vaults/v1/media/id/cover.webp",
        640,
      ),
    );
    // 1×: ceil(280)=280 → 384; 2×: ceil(560)=560 → 640
    assert.match(attrs.srcSet, /384w/);
    assert.match(attrs.srcSet, /640w/);
  });

  it("includes v in derive URLs when sourceMtimeMs is known", () => {
    setHostMediaCredentials("http://127.0.0.1:9", "tok");
    const path = "/data/vaults/v1/media/id/cover.webp";
    const first = buildDerivedImageAttrs({
      displayPath: path,
      slotCssWidthPx: 128,
      devicePixelRatio: 1,
      sourceMtimeMs: 1000,
    });
    const second = buildDerivedImageAttrs({
      displayPath: path,
      slotCssWidthPx: 128,
      devicePixelRatio: 1,
      sourceMtimeMs: 2000,
    });
    assert.equal(
      first.src,
      buildHostMediaDeriveUrl("http://127.0.0.1:9", "tok", path, 128, 1000),
    );
    assert.equal(new URL(first.src).searchParams.get("v"), "1000");
    assert.equal(new URL(second.src).searchParams.get("v"), "2000");
    assert.notEqual(first.src, second.src);
    assert.match(first.srcSet, /[?&]v=1000/);
  });

  it("falls back to display asset src without host credentials", () => {
    const attrs = buildDerivedImageAttrs({
      displayPath: "/vault/cover.webp",
      slotCssWidthPx: 128,
      devicePixelRatio: 1,
    });
    assert.equal(attrs.src, "/vault/cover.webp");
    assert.equal(attrs.srcSet, "/vault/cover.webp");
    assert.equal(attrs.sizes, "128px");
  });
});
