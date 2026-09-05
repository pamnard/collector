import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  generateCoverFromMedia,
  generateCoverFromMediaPath,
  resolveFfmpegBinary,
  resolveServiceHostDir,
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

function makeTinyMp4(): { bytes: Uint8Array; path: string; dir: string } {
  const bin = resolveFfmpegBinary();
  if (!bin) {
    throw new Error("ffmpeg binary required to build video fixture");
  }
  const dir = mkdtempSync(join(tmpdir(), "collector-cover-fixture-"));
  const out = join(dir, "clip.mp4");
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
  return { bytes: new Uint8Array(readFileSync(out)), path: out, dir };
}

describe("seekTargetSeconds", () => {
  it("seeks to five percent of duration", () => {
    expect(seekTargetSeconds(null)).toBe(0);
    expect(seekTargetSeconds(0)).toBe(0);
    expect(seekTargetSeconds(100)).toBe(5);
    expect(seekTargetSeconds(8 * 3600)).toBe(8 * 3600 * 0.05);
  });
});

describe("resolveServiceHostDir (#441)", () => {
  it("uses import.meta.url when present", () => {
    const filePath = "/opt/collector-service-host/cli.js";
    expect(
      resolveServiceHostDir({
        metaUrl: pathToFileURL(filePath).href,
        argv1: "/ignored/cli.js",
        execPath: "/ignored/node",
      }),
    ).toBe("/opt/collector-service-host");
  });

  it("falls back to dirname(argv1) when metaUrl is missing", () => {
    expect(
      resolveServiceHostDir({
        argv1: "/opt/collector-service-host/cli.js",
        execPath: "/ignored/node",
      }),
    ).toBe("/opt/collector-service-host");
  });

  it("falls back to dirname(execPath) when metaUrl and argv1 are missing", () => {
    expect(
      resolveServiceHostDir({
        execPath: "/opt/collector-service-host/node",
      }),
    ).toBe("/opt/collector-service-host");
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
    const meta = await sharp(Buffer.from(cover!.data)).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBeLessThanOrEqual(480);
    expect(meta.height).toBeLessThanOrEqual(480);
    expect(cover!.size).toEqual({ width: meta.width, height: meta.height });
  });

  it("extracts a video frame to webp cover when ffmpeg is available", async () => {
    if (!ffmpegAvailable()) {
      throw new Error(
        "ffmpeg required for #267 video cover extract test (install ffmpeg or set COLLECTOR_FFMPEG)",
      );
    }

    const fixture = makeTinyMp4();
    try {
      const cover = await generateCoverFromMedia(
        fixture.bytes,
        "clip.mp4",
        "video",
      );

      expect(cover).not.toBeNull();
      const meta = await sharp(Buffer.from(cover!.data)).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.width).toBeLessThanOrEqual(480);
      expect(meta.height).toBeLessThanOrEqual(480);
      expect(cover!.size).toEqual({ width: meta.width, height: meta.height });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("extracts a video cover from an on-disk path without buffering bytes", async () => {
    if (!ffmpegAvailable()) {
      throw new Error(
        "ffmpeg required for path cover test (install ffmpeg or set COLLECTOR_FFMPEG)",
      );
    }

    const fixture = makeTinyMp4();
    try {
      const cover = await generateCoverFromMediaPath(
        fixture.path,
        "clip.mp4",
        "video",
      );
      expect(cover).not.toBeNull();
      const meta = await sharp(Buffer.from(cover!.data)).metadata();
      expect(meta.format).toBe("webp");
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
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
