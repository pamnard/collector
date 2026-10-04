/**
 * Ensure Playwright Chromium sits next to the local domain host
 * (`dist/host/ms-playwright/`), same product idea as bundled yt-dlp/ffmpeg (#304).
 *
 * Cache: .cache/collector-node/ms-playwright-v${playwrightVersion}/
 * Install uses the workspace playwright package (pin in package.json).
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const repoRoot = join(packageRoot, "..", "..");
const destDir = join(packageRoot, "dist", "host", "ms-playwright");
const require = createRequire(join(packageRoot, "package.json"));

function playwrightVersion() {
  const pkg = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8"),
  );
  const raw = pkg.dependencies?.playwright;
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("ensure-host-chromium: playwright missing from package.json");
  }
  return raw.replace(/^[^0-9]*/, "");
}

/**
 * Fresh Node process: Playwright caches browsers path on first import in-process.
 */
function chromiumExecutable(browsersPath) {
  const packageJson = join(packageRoot, "package.json");
  const script = `
const { createRequire } = require("node:module");
const { existsSync } = require("node:fs");
const requireFromPkg = createRequire(${JSON.stringify(packageJson)});
const { chromium } = requireFromPkg("playwright");
const exe = chromium.executablePath();
if (!existsSync(exe)) process.exit(2);
process.stdout.write(exe);
`;
  const result = spawnSync(process.execPath, ["-e", script], {
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath },
    encoding: "utf8",
  });
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.trim();
  }
  return null;
}

function installChromium(browsersPath) {
  mkdirSync(browsersPath, { recursive: true });
  // package exports omit ./cli.js; bin points at cli.js next to index.js
  const cli = join(dirname(require.resolve("playwright")), "cli.js");
  if (!existsSync(cli)) {
    throw new Error(`ensure-host-chromium: playwright cli missing at ${cli}`);
  }
  console.log(
    `[ensure-host-chromium] playwright install chromium → ${browsersPath}`,
  );
  const result = spawnSync(process.execPath, [cli, "install", "chromium"], {
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(
      `ensure-host-chromium: playwright install chromium failed (status ${result.status})`,
    );
  }
}

function main() {
  const version = playwrightVersion();
  const cacheDir = join(
    repoRoot,
    ".cache",
    "collector-node",
    `ms-playwright-v${version}`,
  );

  mkdirSync(dirname(destDir), { recursive: true });
  const already = chromiumExecutable(destDir);
  if (already) {
    console.log(`[ensure-host-chromium] already present ${already}`);
    return;
  }

  let cachedExe = chromiumExecutable(cacheDir);
  if (!cachedExe) {
    installChromium(cacheDir);
    cachedExe = chromiumExecutable(cacheDir);
  }
  if (!cachedExe) {
    throw new Error(
      `ensure-host-chromium: chromium missing under cache ${cacheDir}`,
    );
  }

  rmSync(destDir, { recursive: true, force: true });
  cpSync(cacheDir, destDir, { recursive: true });
  const published = chromiumExecutable(destDir);
  if (!published) {
    throw new Error(
      `ensure-host-chromium: chromium missing after publish to ${destDir}`,
    );
  }
  console.log(`[ensure-host-chromium] published ${published}`);
}

main();
