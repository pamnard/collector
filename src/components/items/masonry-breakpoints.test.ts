import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MASONRY_BREAKPOINTS,
  columnCountForWidth,
} from "./masonry-breakpoints.ts";

describe("columnCountForWidth", () => {
  it("matches MASONRY_BREAKPOINTS for narrow / mid / wide / ultrawide", () => {
    assert.equal(columnCountForWidth(375, MASONRY_BREAKPOINTS), 1);
    assert.equal(columnCountForWidth(500, MASONRY_BREAKPOINTS), 1);
    assert.equal(columnCountForWidth(768, MASONRY_BREAKPOINTS), 2);
    assert.equal(columnCountForWidth(1280, MASONRY_BREAKPOINTS), 3);
    assert.equal(columnCountForWidth(1536, MASONRY_BREAKPOINTS), 3);
    assert.equal(columnCountForWidth(1920, MASONRY_BREAKPOINTS), 4);
    assert.equal(columnCountForWidth(2240, MASONRY_BREAKPOINTS), 5);
    assert.equal(columnCountForWidth(2560, MASONRY_BREAKPOINTS), 6);
    assert.equal(columnCountForWidth(3440, MASONRY_BREAKPOINTS), 7);
  });

  it("uses default above the largest named breakpoint", () => {
    assert.equal(columnCountForWidth(4000, MASONRY_BREAKPOINTS), 7);
  });

  it("picks the smallest matching breakpoint key (library semantics)", () => {
    // 900 ≤ 1280…3440 but not ≤ 768; smallest key = 1280 → 3
    assert.equal(columnCountForWidth(900, MASONRY_BREAKPOINTS), 3);
    // 700 ≤ 768…; smallest key = 768 → 2
    assert.equal(columnCountForWidth(700, MASONRY_BREAKPOINTS), 2);
    assert.equal(columnCountForWidth(1400, MASONRY_BREAKPOINTS), 3);
  });
});
