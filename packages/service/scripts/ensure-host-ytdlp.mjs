/**
 * Ensure yt-dlp sits next to the local domain host (`dist/host/bin/`), same
 * layout as the packaged release (#317). Downloads a pinned standalone binary
 * when missing — not a user PATH install.
 *
 * Cache layout matches scripts/prepare-service-host-resources.sh:
 *   .cache/collector-node/yt-dlp-${platformArch}-v${VERSION}/
 * SHA-256 pins match yt-dlp 2026.08.19 SHA2-256SUMS.
 */

import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const YT_DLP_VERSION = process.env.COLLECTOR_YT_DLP_VERSION ?? "2026.08.19";

/** Asset → sha256 for the pinned release (SHA2-256SUMS). */
const YT_DLP_SHA256 = {
  "yt-dlp_linux":
    "58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a",
  "yt-dlp_linux_aarch64":
    "b16e4dab368a816cd05d477d698a605a6ae87ccee1c8ffd38fa21d7254141fcc",
  "yt-dlp_macos":
    "0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202",
  "yt-dlp.exe":
    "66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a",
};

const packageRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const repoRoot = join(packageRoot, "..", "..");
const destDir = join(packageRoot, "dist", "host", "bin");

function platformArch() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "win32" && arch === "arm64") return "win-arm64";
  if (platform === "win32") return "win-x64";
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "darwin") return "darwin-x64";
  if (platform === "linux" && arch === "arm64") return "linux-arm64";
  if (platform === "linux") return "linux-x64";
  throw new Error(
    `ensure-host-ytdlp: unsupported platform ${platform}/${arch}`,
  );
}

function platformAsset(arch) {
  switch (arch) {
    case "linux-x64":
      return { asset: "yt-dlp_linux", binName: "yt-dlp" };
    case "linux-arm64":
      return { asset: "yt-dlp_linux_aarch64", binName: "yt-dlp" };
    case "darwin-x64":
    case "darwin-arm64":
      return { asset: "yt-dlp_macos", binName: "yt-dlp" };
    case "win-x64":
    case "win-arm64":
      return { asset: "yt-dlp.exe", binName: "yt-dlp.exe" };
    default:
      throw new Error(`ensure-host-ytdlp: no asset for ${arch}`);
  }
}

function assertSha256(path, expected) {
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `ensure-host-ytdlp: sha256 mismatch for ${path}: got ${actual}, expected ${expected}`,
    );
  }
}

async function download(url, dest) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || response.body === null) {
    throw new Error(
      `ensure-host-ytdlp: download failed ${response.status} ${url}`,
    );
  }
  mkdirSync(dirname(dest), { recursive: true });
  const partial = `${dest}.partial`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
    renameSync(partial, dest);
  } catch (error) {
    if (existsSync(partial)) {
      unlinkSync(partial);
    }
    throw error;
  }
}

async function main() {
  const arch = platformArch();
  const { asset, binName } = platformAsset(arch);
  const expectedSha = YT_DLP_SHA256[asset];
  if (!expectedSha) {
    throw new Error(`ensure-host-ytdlp: no sha256 pin for asset ${asset}`);
  }

  const dest = join(destDir, binName);
  if (existsSync(dest)) {
    assertSha256(dest, expectedSha);
    console.log(`[ensure-host-ytdlp] already present ${dest}`);
    return;
  }

  const cacheRoot = join(
    repoRoot,
    ".cache",
    "collector-node",
    `yt-dlp-${arch}-v${YT_DLP_VERSION}`,
  );
  const cached = join(cacheRoot, binName);
  if (!existsSync(cached)) {
    const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/${asset}`;
    console.log(`[ensure-host-ytdlp] download ${url}`);
    await download(url, cached);
    chmodSync(cached, 0o755);
  }
  assertSha256(cached, expectedSha);

  mkdirSync(destDir, { recursive: true });
  copyFileSync(cached, dest);
  chmodSync(dest, 0o755);
  assertSha256(dest, expectedSha);
  console.log(`[ensure-host-ytdlp] published ${dest}`);
}

await main();
