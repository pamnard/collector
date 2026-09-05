/**
 * Video cover seek: 5% of duration.
 */

import { describe, expect, it } from "vitest";
import { seekTargetSeconds } from "./video-cover-seek.js";

describe("seekTargetSeconds", () => {
  it("returns 0 for missing duration", () => {
    expect(seekTargetSeconds(null)).toBe(0);
    expect(seekTargetSeconds(0)).toBe(0);
    expect(seekTargetSeconds(Number.NaN)).toBe(0);
  });

  it("seeks to five percent of duration", () => {
    expect(seekTargetSeconds(100)).toBe(5);
    expect(seekTargetSeconds(0.4)).toBeCloseTo(0.02);
    expect(seekTargetSeconds(8 * 3600)).toBe(8 * 3600 * 0.05);
  });
});
