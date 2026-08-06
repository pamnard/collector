/**
 * Platform-local IPC endpoint paths (#152).
 * Unix domain socket on Linux/macOS; Windows named pipe.
 */

import { createHash } from "node:crypto";
import { join } from "node:path";

export function defaultServiceIpcPath(dataDir: string): string {
  if (process.platform === "win32") {
    const id = createHash("sha256").update(dataDir).digest("hex").slice(0, 16);
    return `\\\\.\\pipe\\collector-service-${id}`;
  }
  return join(dataDir, "collector-service.sock");
}

export function isWindowsNamedPipePath(path: string): boolean {
  return path.startsWith("\\\\.\\pipe\\") || path.startsWith("//./pipe/");
}
