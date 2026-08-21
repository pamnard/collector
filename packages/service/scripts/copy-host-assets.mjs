/**
 * Publish host worker assets that tsc does not emit (plain .mjs).
 * Fails fast if the source is missing or the copy did not land in dist/.
 */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const src = join(packageRoot, "src/host/node-sql-worker.mjs");
const dest = join(packageRoot, "dist/host/node-sql-worker.mjs");

if (!existsSync(src)) {
  throw new Error(`Missing SQLite worker source asset: ${src}`);
}

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);

if (!existsSync(dest)) {
  throw new Error(`Failed to publish SQLite worker asset to ${dest}`);
}

console.log(`[copy-host-assets] published ${dest}`);
