import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  itemGridCoverImgClassName,
  itemGridCoverSlot,
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

describe("itemGridCoverImgClassName", () => {
  it("takes the in-flight cover img out of layout flow", () => {
    const classes = itemGridCoverImgClassName({ loadCover: true });
    assert.match(classes, /\babsolute\b/);
    assert.match(classes, /\bopacity-0\b/);
    // In-flow h-auto would stack with the aspect placeholder when dimensions are known.
    assert.doesNotMatch(classes, /\bh-auto\b/);
  });

  it("lets the settled cover img own layout height", () => {
    const classes = itemGridCoverImgClassName({ loadCover: false });
    assert.match(classes, /\bh-auto\b/);
    assert.match(classes, /\bw-full\b/);
    assert.doesNotMatch(classes, /\babsolute\b/);
    assert.doesNotMatch(classes, /\bopacity-0\b/);
  });
});
