/**
 * Host token filename/path helpers for scripts (#550 cleanup D).
 */
import { join } from "node:path";
import { createRequire } from "node:module";
import { dirname, join as pathJoin } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = pathJoin(dirname(fileURLToPath(import.meta.url)), "../..");

function loadTokenFilename() {
  try {
    const host = require(join(ROOT, "packages/service/dist/host-entry.js"));
    if (typeof host.SERVICE_HOST_TOKEN_FILENAME === "string") {
      return host.SERVICE_HOST_TOKEN_FILENAME;
    }
  } catch {
    // Keep in sync with packages/service/src/host/wire/auth.ts
  }
  return "collector-service.host-token";
}

export const SERVICE_HOST_TOKEN_FILENAME = loadTokenFilename();

export function hostTokenPath(dataDir) {
  return join(dataDir, SERVICE_HOST_TOKEN_FILENAME);
}
