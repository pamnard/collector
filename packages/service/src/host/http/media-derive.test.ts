/**
 * Unit tests for `/media/derive` helpers (#882 / #933).
 */

import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
  utimesSync,
  statSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  encodeDerivedWebpDefault,
  handleMediaDerive,
  imageDeriveCacheDir,
  isMediaDeriveRequest,
  mediaDeriveBrowserCacheControl,
  mediaDeriveCacheKey,
  mediaDeriveEtag,
  mediaDeriveTempPath,
  parseMediaDeriveVersionQuery,
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

  it("mediaDeriveEtag and Cache-Control never set immutable", () => {
    const key = mediaDeriveCacheKey({
      resolvedPath: "/vault/a.webp",
      mtimeMs: 100,
      width: 640,
      quality: 85,
    });
    expect(mediaDeriveEtag(key)).toMatch(/^"[a-f0-9]{64}"$/);
    expect(mediaDeriveBrowserCacheControl(false)).toBe(
      "private, max-age=0, must-revalidate",
    );
    expect(mediaDeriveBrowserCacheControl(true)).toBe(
      "private, max-age=31536000",
    );
    expect(mediaDeriveBrowserCacheControl(true)).not.toMatch(/immutable/);
  });

  it("parseMediaDeriveVersionQuery accepts integer v or absence", () => {
    expect(parseMediaDeriveVersionQuery(null)).toEqual({
      ok: true,
      value: null,
    });
    expect(parseMediaDeriveVersionQuery("")).toEqual({ ok: true, value: null });
    expect(parseMediaDeriveVersionQuery("1700")).toEqual({
      ok: true,
      value: 1700,
    });
    expect(parseMediaDeriveVersionQuery("1.5").ok).toBe(false);
    expect(parseMediaDeriveVersionQuery("-1").ok).toBe(false);
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
    const touchedMtimeMs = statSync(sourcePath).mtimeMs;
    expect(touchedMtimeMs).not.toBe(2000);
    await readOrCreateDerivedWebp({
      cacheDir,
      resolvedPath: sourcePath,
      mtimeMs: touchedMtimeMs,
      width: 256,
      encodeWebp,
    });
    expect(encodeWebp).toHaveBeenCalledTimes(3);
  });

  it("readOrCreateDerivedWebp concurrent same-key: one encode, both succeed (#933)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-derive-race-"));
    dirs.push(dir);
    const sourcePath = join(dir, "src.png");
    writeFileSync(
      sourcePath,
      await sharp({
        create: {
          width: 320,
          height: 160,
          channels: 3,
          background: { r: 2, g: 3, b: 4 },
        },
      })
        .png()
        .toBuffer(),
    );
    const cacheDir = join(dir, "image-derive-cache");
    let releaseEncode!: () => void;
    const encodeGate = new Promise<void>((resolve) => {
      releaseEncode = resolve;
    });
    const encodeWebp = vi.fn(async () => {
      await encodeGate;
      return sharp({
        create: {
          width: 256,
          height: 128,
          channels: 3,
          background: { r: 7, g: 8, b: 9 },
        },
      })
        .webp()
        .toBuffer();
    });

    const first = readOrCreateDerivedWebp({
      cacheDir,
      resolvedPath: sourcePath,
      mtimeMs: 1000,
      width: 256,
      encodeWebp,
    });
    const second = readOrCreateDerivedWebp({
      cacheDir,
      resolvedPath: sourcePath,
      mtimeMs: 1000,
      width: 256,
      encodeWebp,
    });
    // Both callers must be waiting on the shared encode before we release it.
    await vi.waitFor(() => {
      expect(encodeWebp).toHaveBeenCalledTimes(1);
    });
    releaseEncode();
    const [a, b] = await Promise.all([first, second]);
    expect(Buffer.compare(a.bytes, b.bytes)).toBe(0);
    expect(encodeWebp).toHaveBeenCalledTimes(1);
    expect(readdirSync(cacheDir).filter((name) => name.endsWith(".webp"))).toHaveLength(
      1,
    );
    expect(readdirSync(cacheDir).some((name) => name.endsWith(".tmp"))).toBe(
      false,
    );
  });

  it("mediaDeriveTempPath is unique per call (no pid+Date.now collision) (#933)", () => {
    const cachePath = "/tmp/image-derive-cache/abc.webp";
    const paths = new Set(
      Array.from({ length: 64 }, () => mediaDeriveTempPath(cachePath)),
    );
    expect(paths.size).toBe(64);
    for (const tmp of paths) {
      expect(tmp.startsWith(`${cachePath}.`)).toBe(true);
      expect(tmp.endsWith(".tmp")).toBe(true);
      expect(tmp).not.toMatch(new RegExp(`\\.${process.pid}\\.\\d+\\.tmp$`));
    }
  });

  it("readOrCreateDerivedWebp rename ENOENT re-reads existing cache (#933)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-derive-rename-loser-"));
    dirs.push(dir);
    const sourcePath = join(dir, "src.png");
    writeFileSync(sourcePath, Buffer.from("unused"));
    const cacheDir = join(dir, "image-derive-cache");
    const published = await sharp({
      create: {
        width: 16,
        height: 8,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    })
      .webp()
      .toBuffer();
    const encodeWebp = vi.fn(async () =>
      sharp({
        create: {
          width: 16,
          height: 8,
          channels: 3,
          background: { r: 9, g: 8, b: 7 },
        },
      })
        .webp()
        .toBuffer(),
    );

    const result = await readOrCreateDerivedWebp({
      cacheDir,
      resolvedPath: sourcePath,
      mtimeMs: 42,
      width: 128,
      encodeWebp,
      renameFile: async (_from, to) => {
        writeFileSync(to, published);
        const error = new Error(
          "ENOENT: no such file or directory, rename",
        ) as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
    });
    expect(Buffer.compare(result.bytes, published)).toBe(0);
    expect(encodeWebp).toHaveBeenCalledTimes(1);
  });
});

describe("handleMediaDerive error boundary (#933)", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("maps encode failure to HTTP 500 JSON and does not reject (#933)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-derive-err-"));
    dirs.push(dataDir);
    const vaultsRootPath = join(dataDir, "vaults");
    const mediaDir = join(vaultsRootPath, "v1", "media", "item");
    mkdirSync(mediaDir, { recursive: true });
    const sourcePath = join(mediaDir, "src.png");
    writeFileSync(
      sourcePath,
      await sharp({
        create: {
          width: 64,
          height: 32,
          channels: 3,
          background: { r: 1, g: 1, b: 1 },
        },
      })
        .png()
        .toBuffer(),
    );

    const token = "test-token-933";
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      void handleMediaDerive(req, res, url, {
        expectedToken: token,
        vaultsRootPath,
        dataDir,
        encodeWebp: async () => {
          throw new Error("encode boom for #933");
        },
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("failed to bind test server");
      }
      const res = await fetch(
        `http://127.0.0.1:${address.port}/media/derive?path=${encodeURIComponent(sourcePath)}&w=128&token=${encodeURIComponent(token)}`,
      );
      expect(res.status).toBe(500);
      const body = (await res.json()) as {
        ok: boolean;
        error?: { code?: string; message?: string };
      };
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe("failed");
      expect(body.error?.message).toMatch(/encode boom/);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
