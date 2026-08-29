/**
 * pickMediaDeriveWidth / whitelist (#882).
 */

import { describe, expect, it } from "vitest";
import {
  isMediaDeriveWhitelistWidth,
  MEDIA_DERIVE_MAX_WIDTH,
  MEDIA_DERIVE_WIDTHS,
  mediaDeriveVersionFromMtimeMs,
  pickMediaDeriveWidth,
} from "./media-derive.js";

describe("media-derive width contract (#882)", () => {
  it("exposes the locked whitelist ending at 1920", () => {
    expect([...MEDIA_DERIVE_WIDTHS]).toEqual([
      128, 256, 384, 480, 640, 768, 960, 1280, 1600, 1920,
    ]);
    expect(MEDIA_DERIVE_MAX_WIDTH).toBe(1920);
    expect(isMediaDeriveWhitelistWidth(640)).toBe(true);
    expect(isMediaDeriveWhitelistWidth(641)).toBe(false);
  });

  it("picks nearest whitelist step ≥ needed width", () => {
    expect(pickMediaDeriveWidth(1)).toBe(128);
    expect(pickMediaDeriveWidth(128)).toBe(128);
    expect(pickMediaDeriveWidth(129)).toBe(256);
    expect(pickMediaDeriveWidth(900)).toBe(960);
    expect(pickMediaDeriveWidth(2000)).toBe(1920);
  });

  it("caps needed width by source natural width before stepping", () => {
    expect(pickMediaDeriveWidth(900, 200)).toBe(256);
    expect(pickMediaDeriveWidth(100, 2000)).toBe(128);
  });

  it("mediaDeriveVersionFromMtimeMs truncates and rejects invalid", () => {
    expect(mediaDeriveVersionFromMtimeMs(1_700_000_000_123.9)).toBe(
      1_700_000_000_123,
    );
    expect(() => mediaDeriveVersionFromMtimeMs(Number.NaN)).toThrow(/mtimeMs/);
    expect(() => mediaDeriveVersionFromMtimeMs(-1)).toThrow(/mtimeMs/);
  });
});
