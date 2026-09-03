/**
 * Resolve bundled yt-dlp for YouTube extract (#317).
 * Product path: host `bin/yt-dlp` next to cli.js (release + local dist host).
 * COLLECTOR_YT_DLP is tests/debug only.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveServiceHostDir } from "../../host/node-cover.js";

/**
 * Resolve yt-dlp binary: COLLECTOR_YT_DLP → host bin/.
 * Returns null when neither exists (extract must fail explicitly).
 */
export function resolveYtdlpBinary(): string | null {
  const fromEnv = process.env.COLLECTOR_YT_DLP?.trim();
  if (fromEnv) {
    return existsSync(fromEnv) ? fromEnv : null;
  }

  const exe = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  // Prefer running host entry (cli.js), not this module's extract/ folder.
  const root = resolveServiceHostDir({
    argv1: process.argv[1],
    execPath: process.execPath,
  });
  const bundledCandidates = [
    join(root, "bin", exe),
    join(
      root,
      "..",
      "..",
      "..",
      "..",
      "dist",
      "collector-release",
      "collector-service-host",
      "bin",
      exe,
    ),
  ];

  for (const candidate of bundledCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
