/**
 * Duration → max height scale for YouTube format selection.
 */

import { describe, expect, it } from "vitest";
import {
  YOUTUBE_DURATION_720_MAX_SECONDS,
  youtubeFormatForMaxHeight,
  youtubeMaxHeightForDurationSeconds,
} from "./duration-height.js";

describe("youtubeMaxHeightForDurationSeconds", () => {
  it("uses 720 up to and including one hour", () => {
    expect(youtubeMaxHeightForDurationSeconds(0)).toBe(720);
    expect(youtubeMaxHeightForDurationSeconds(1)).toBe(720);
    expect(
      youtubeMaxHeightForDurationSeconds(YOUTUBE_DURATION_720_MAX_SECONDS),
    ).toBe(720);
  });

  it("uses 480 above one hour and never lower", () => {
    expect(
      youtubeMaxHeightForDurationSeconds(YOUTUBE_DURATION_720_MAX_SECONDS + 1),
    ).toBe(480);
    expect(youtubeMaxHeightForDurationSeconds(8 * 3600)).toBe(480);
  });

  it("refuses non-finite duration", () => {
    expect(() => youtubeMaxHeightForDurationSeconds(Number.NaN)).toThrow(
      /duration refused/,
    );
  });
});

describe("youtubeFormatForMaxHeight", () => {
  it("builds muxed format with height ceiling", () => {
    expect(youtubeFormatForMaxHeight(720)).toBe(
      "bv*[height<=720]+ba/b[height<=720]",
    );
    expect(youtubeFormatForMaxHeight(480)).toBe(
      "bv*[height<=480]+ba/b[height<=480]",
    );
  });
});
