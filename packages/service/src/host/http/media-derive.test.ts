/**
 * Unit tests for `/media/derive` helpers (#882).
 */

import { mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  encodeDerivedWebpDefault,
  imageDeriveCacheDir,
  isMediaDeriveRequest,
  mediaDeriveCacheKey,
  readOrCreateDerivedWebp,
} from "./media-derive.js";

describe("media-derive helpers (#882)", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("isMediaDeriveRequest matches GET/HEAD on /media/derive only", () => {
    expect(isMediaDeriveRequest("GET", "/media/derive")).toBe(true);
    expect(isMediaDeriveRequest("HEAD", "/media/derive")).toBe(true);
    expect(isMediaDeriveRequest("POST", "/media/derive")).toBe(false);
    expect(isMediaDeriveRequest("GET", "/media/file")).toBe(false);
  });

  it("imageDeriveCacheDir sits under dataDir, not vault", () => {
    expect(imageDeriveCacheDir("/data/profile")).toBe(
      join("/data/profile", "image-derive-cache"),
    );
  });

  it("mediaDeriveCacheKey changes when path, mtime, w, or quality change", () => {
    const base = {
      resolvedPath: "/vault/a.webp",
      mtimeMs: 100,
      width: 640 as const,
      quality: 85,
    };
    const a = mediaDeriveCacheKey(base);
    expect(a).toMatch(/^[a-f0-9]{64}\.webp$/);
    expect(mediaDeriveCacheKey({ ...base, mtimeMs: 101 })).not.toBe(a);
    expect(mediaDeriveCacheKey({ ...base, width: 480 })).not.toBe(a);
    expect(mediaDeriveCacheKey({ ...base, quality: 80 })).not.toBe(a);
    expect(
      mediaDeriveCacheKey({ ...base, resolvedPath: "/vault/b.webp" }),
    ).not.toBe(a);
  });

  it("encodeDerivedWebpDefault never upscales and always emits webp", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-derive-src-"));
    dirs.push(dir);
    const sourcePath = join(dir, "small.png");
    await sharp({
      create: {
        width: 200,
        height: 100,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .png()
      .toFile(sourcePath);

    const bytes = await encodeDerivedWebpDefault({
      sourcePath,
      width: 640,
      quality: 85,
    });
    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(100);
  });

  it("encodeDerivedWebpDefault downscales when source is wider than w", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-derive-src-"));
    dirs.push(dir);
    const sourcePath = join(dir, "wide.png");
    await sharp({
      create: {
        width: 1200,
        height: 600,
        channels: 3,
        background: { r: 40, g: 50, b: 60 },
      },
    })
      .png()
      .toFile(sourcePath);

    const bytes = await encodeDerivedWebpDefault({
      sourcePath,
      width: 480,
      quality: 85,
    });
    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(480);
    expect(meta.height).toBe(240);
  });

  it("readOrCreateDerivedWebp caches on disk and skips re-encode on hit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-derive-cache-"));
    dirs.push(dir);
    const sourcePath = join(dir, "src.png");
    writeFileSync(sourcePath, await sharp({
      create: {
        width: 400,
        height: 200,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    })
      .png()
      .toBuffer());
    const cacheDir = join(dir, "image-derive-cache");
    const encodeWebp = vi.fn(async () =>
      sharp({
        create: {
          width: 256,
          height: 128,
          channels: 3,
          background: { r: 9, g: 8, b: 7 },
        },
      })
        .webp()
        .toBuffer(),
    );

    const first = await readOrCreateDerivedWebp({
      cacheDir,
      resolvedPath: sourcePath,
      mtimeMs: 1000,
      width: 256,
      encodeWebp,
    });
    expect(first.cacheHit).toBe(false);
    expect(encodeWebp).toHaveBeenCalledTimes(1);

    const second = await readOrCreateDerivedWebp({
      cacheDir,
      resolvedPath: sourcePath,
      mtimeMs: 1000,
      width: 256,
      encodeWebp,
    });
    expect(second.cacheHit).toBe(true);
    expect(encodeWebp).toHaveBeenCalledTimes(1);
    expect(Buffer.compare(first.bytes, second.bytes)).toBe(0);
  });

  it("readOrCreateDerivedWebp re-encodes when source mtime changes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-derive-mtime-"));
    dirs.push(dir);
    const sourcePath = join(dir, "src.png");
    writeFileSync(
      sourcePath,
      await sharp({
        create: {
          width: 300,
          height: 150,
          channels: 3,
          background: { r: 5, g: 6, b: 7 },
        },
      })
        .png()
        .toBuffer(),
    );
    const cacheDir = join(dir, "image-derive-cache");
    const encodeWebp = vi.fn(async ({ width }: { width: number }) =>
      sharp({
        create: {
          width,
          height: Math.round(width / 2),
          channels: 3,
          background: { r: 11, g: 12, b: 13 },
        },
      })
        .webp()
        .toBuffer(),
    );

    await readOrCreateDerivedWebp({
      cacheDir,
      resolvedPath: sourcePath,
      mtimeMs: 1000,
      width: 256,
      encodeWebp,
    });
    await readOrCreateDerivedWebp({
      cacheDir,
      resolvedPath: sourcePath,
      mtimeMs: 2000,
      width: 256,
      encodeWebp,
    });
    expect(encodeWebp).toHaveBeenCalledTimes(2);

    // Touching the real file mtime must also invalidate via a new key.
    utimesSync(sourcePath, new Date(3_000_000), new Date(3_000_000));
    const touched = await sharp(sourcePath).metadata();
    expect(touched.width).toBe(300);
  });
});
