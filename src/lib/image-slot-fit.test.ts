import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALL_IMAGE_DISPLAY_SLOTS,
  deriveSrcSetWidthsForSlot,
  imageDisplaySlotById,
  neededDeriveWidthForSlot,
} from "./image-slot-fit.ts";

describe("image-slot-fit (#882)", () => {
  it("catalogs grid, related, thumbnail, and detail-hero slots", () => {
    assert.deepEqual(
      ALL_IMAGE_DISPLAY_SLOTS.map((s) => s.id),
      ["dashboard-grid", "related-teaser", "thumbnail", "detail-hero"],
    );
    assert.equal(imageDisplaySlotById("detail-hero").cssWidthPx, 900);
  });

  it("computes needed whitelist width from CSS × DPR", () => {
    assert.equal(
      neededDeriveWidthForSlot({
        slotCssWidthPx: 280,
        devicePixelRatio: 2,
      }),
      640,
    );
    assert.equal(
      neededDeriveWidthForSlot({
        slotCssWidthPx: 900,
        devicePixelRatio: 2,
      }),
      1920,
    );
  });

  it("builds 1x/2x srcset width list", () => {
    assert.deepEqual(deriveSrcSetWidthsForSlot({ slotCssWidthPx: 128 }), [
      128,
      256,
    ]);
  });
});
