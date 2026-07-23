import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  generateCoverFromMedia,
  resolveFfmpegBinary,
  seekTargetSeconds,
} from "./node-cover.js";

function ffmpegAvailable(): boolean {
  const bin = resolveFfmpegBinary();
  if (!bin) {
    return false;
  }
  try {
    execFileSync(bin, ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function makeTinyMp4(): Uint8Array {
  const bin = resolveFfmpegBinary();
  if (!bin) {
    throw new Error("ffmpeg binary required to build video fixture");
  }
  const dir = mkdtempSync(join(tmpdir(), "collector-cover-fixture-"));
  const out = join(dir, "clip.mp4");
  try {
    execFileSync(
      bin,
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=320x240:d=1",
        "-c:v",
        "libx264",
        "-t",
        "1",
        "-pix_fmt",
        "yuv420p",
        out,
      ],
      { stdio: "ignore" },
    );
    return new Uint8Array(readFileSync(out));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("seekTargetSeconds", () => {
  it("matches browser policy", () => {
    expect(seekTargetSeconds(null)).toBe(0);
    expect(seekTargetSeconds(0)).toBe(0);
    expect(seekTargetSeconds(0.4)).toBe(0.2);
    expect(seekTargetSeconds(10)).toBe(0.5);
  });
});

describe("generateCoverFromMedia (node)", () => {
  const previousFfmpeg = process.env.COLLECTOR_FFMPEG;

  afterEach(() => {
    if (previousFfmpeg === undefined) {
      delete process.env.COLLECTOR_FFMPEG;
    } else {
      process.env.COLLECTOR_FFMPEG = previousFfmpeg;
    }
  });

  it("resizes an image to webp cover", async () => {
    const png = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 20, g: 40, b: 60 },
      },
    })
      .png()
      .toBuffer();

    const cover = await generateCoverFromMedia(
      new Uint8Array(png),
      "photo.png",
      "image",
    );

    expect(cover).not.toBeNull();
    const meta = await sharp(Buffer.from(cover!)).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBeLessThanOrEqual(480);
    expect(meta.height).toBeLessThanOrEqual(480);
  });

  it("extracts a video frame to webp cover when ffmpeg is available", async () => {
    if (!ffmpegAvailable()) {
      throw new Error(
        "ffmpeg required for #267 video cover extract test (install ffmpeg or set COLLECTOR_FFMPEG)",
      );
    }

    const mp4 = makeTinyMp4();
    const cover = await generateCoverFromMedia(mp4, "clip.mp4", "video");

    expect(cover).not.toBeNull();
    const meta = await sharp(Buffer.from(cover!)).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBeLessThanOrEqual(480);
    expect(meta.height).toBeLessThanOrEqual(480);
  });

  it("soft-fails to null when COLLECTOR_FFMPEG points at a missing binary", async () => {
    process.env.COLLECTOR_FFMPEG = join(
      tmpdir(),
      "collector-missing-ffmpeg-binary",
    );
    const cover = await generateCoverFromMedia(
      new Uint8Array([0, 1, 2]),
      "clip.mp4",
      "video",
    );
    expect(cover).toBeNull();
  });

  it("soft-fails to null for garbage video bytes when ffmpeg is available", async () => {
    if (!ffmpegAvailable()) {
      throw new Error(
        "ffmpeg required for #267 video cover soft-fail test (install ffmpeg or set COLLECTOR_FFMPEG)",
      );
    }

    const cover = await generateCoverFromMedia(
      new Uint8Array([0, 1, 2, 3, 4]),
      "clip.mp4",
      "video",
    );
    expect(cover).toBeNull();
  });
});
