import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  itemGridCoverImgClassName,
  itemGridCoverSlot,
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

describe("itemGridCoverSlotPending", () => {
  it("does not reserve a teaser for notes while cover path is unresolved", () => {
    assert.equal(
      itemGridCoverSlotPending({
        coverPending: false,
        pathUnresolved: true,
        optimisticPortrait: false,
      }),
      false,
    );
  });

  it("reserves a teaser for image/video while cover path is unresolved", () => {
    assert.equal(
      itemGridCoverSlotPending({
        coverPending: false,
        pathUnresolved: true,
        optimisticPortrait: true,
      }),
      true,
    );
  });

  it("keeps an in-flight decode teaser even for non-portrait items", () => {
    assert.equal(
      itemGridCoverSlotPending({
        coverPending: true,
        pathUnresolved: false,
        optimisticPortrait: false,
      }),
      true,
    );
  });
});
