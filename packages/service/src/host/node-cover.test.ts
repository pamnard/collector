import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { generateCoverFromMedia } from "./node-cover.js";

describe("generateCoverFromMedia (node)", () => {
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

  it("returns null for video (no ffmpeg in host)", async () => {
    const cover = await generateCoverFromMedia(
      new Uint8Array([0, 1, 2]),
      "clip.mp4",
      "video",
    );
    expect(cover).toBeNull();
  });
});
