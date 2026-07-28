import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { itemGridCoverSlot } from "./item-grid-cover-slot.ts";

describe("itemGridCoverSlot", () => {
  it("shows pending only while a cover attempt is in flight", () => {
    assert.deepEqual(
      itemGridCoverSlot({
        expectedCoverSrc: "/cover.jpg",
        coverSrc: null,
        coverSettled: false,
      }),
      { coverPending: true, showCover: false },
    );
  });

  it("hides the teaser after a failed or timed-out cover decode", () => {
    assert.deepEqual(
      itemGridCoverSlot({
        expectedCoverSrc: "/missing.jpg",
        coverSrc: null,
        coverSettled: true,
      }),
      { coverPending: false, showCover: false },
    );
  });

  it("shows the cover only after a successful settle", () => {
    assert.deepEqual(
      itemGridCoverSlot({
        expectedCoverSrc: "/cover.jpg",
        coverSrc: "/cover.jpg",
        coverSettled: true,
      }),
      { coverPending: false, showCover: true },
    );
  });

  it("never reserves a teaser when there is no expected cover", () => {
    assert.deepEqual(
      itemGridCoverSlot({
        expectedCoverSrc: null,
        coverSrc: null,
        coverSettled: false,
      }),
      { coverPending: false, showCover: false },
    );
  });
});
