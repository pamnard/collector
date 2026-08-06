/**
 * Shared READY-line waiter for host launcher/smoke scripts (#550 cleanup D).
 */
import { createInterface } from "node:readline";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function loadReadyPrefix() {
  try {
    const host = require(join(ROOT, "packages/service/dist/host-entry.js"));
    if (typeof host.SERVICE_HOST_READY_PREFIX === "string") {
      return host.SERVICE_HOST_READY_PREFIX;
    }
  } catch {
    // Dist may be missing in some local flows; keep string in sync with service-host.ts.
  }
  return "COLLECTOR_SERVICE_READY ";
}

export const SERVICE_HOST_READY_PREFIX = loadReadyPrefix();

/**
 * @param {import("node:child_process").ChildProcessWithoutNullStreams} child
 * @param {{ timeoutMs?: number, echoStdout?: boolean }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export function waitForServiceReady(child, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const echoStdout = options.echoStdout === true;
  const prefix = SERVICE_HOST_READY_PREFIX;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for ${prefix.trim()}`));
    }, timeoutMs);

    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (echoStdout) {
        console.log(line);
      }
      if (!line.startsWith(prefix)) {
        return;
      }
      clearTimeout(timer);
      rl.close();
      try {
        resolve(JSON.parse(line.slice(prefix.length)));
      } catch (error) {
        reject(error);
      }
    });

    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });

    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(
          `host exited before READY (code=${code}, signal=${signal})`,
        ),
      );
    });
  });
}
