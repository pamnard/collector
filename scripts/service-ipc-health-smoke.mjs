/**
 * Local IPC transport smoke (#152).
 *
 * Spawns `collector-service serve`, dials the READY `ipcPath`, runs health/ping
 * over framed IPC, then SIGTERM for a clean exit.
 *
 * Local / CI:
 *   npm run test:service-ipc
 *
 * Also run from `npm run verify:release`.
 * App production path must stay in-process (does not dial this host).
 */
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages/service/dist/host/cli.js");
const READY_PREFIX = "COLLECTOR_SERVICE_READY ";
const READY_TIMEOUT_MS = 30_000;
const PROTOCOL_VERSION = 1;

function fail(message) {
  console.error("FAIL:", message);
  process.exitCode = 1;
}

function encodeFrame(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

async function ipcRequest(path, method) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path }, () => {
      socket.write(
        encodeFrame({
          v: PROTOCOL_VERSION,
          id: "1",
          type: "req",
          method,
        }),
      );
    });

    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`IPC ${method} timed out`));
    }, 10_000);

    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 4) return;
      const len = buf.readUInt32BE(0);
      if (buf.length < 4 + len) return;
      clearTimeout(timer);
      const message = JSON.parse(buf.subarray(4, 4 + len).toString("utf8"));
      socket.end();
      resolve(message);
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function waitForReady(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for ${READY_PREFIX.trim()}`));
    }, READY_TIMEOUT_MS);

    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (!line.startsWith(READY_PREFIX)) {
        return;
      }
      clearTimeout(timer);
      rl.close();
      try {
        resolve(JSON.parse(line.slice(READY_PREFIX.length)));
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

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.on("exit", (code, signal) => {
      resolve({ code, signal });
    });
    child.on("error", reject);
  });
}

const dataDir = mkdtempSync(join(tmpdir(), "collector-service-ipc-smoke-"));
const child = spawn(
  process.execPath,
  [CLI, "serve", "--data-dir", dataDir, "--port", "0"],
  {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  },
);

try {
  const ready = await waitForReady(child);
  if (!ready?.ipcPath) {
    throw new Error(`READY missing ipcPath: ${JSON.stringify(ready)}`);
  }

  const ping = await ipcRequest(ready.ipcPath, "ping");
  if (ping.type !== "res" || !ping.result?.pong) {
    throw new Error(`IPC ping failed: ${JSON.stringify(ping)}`);
  }

  const health = await ipcRequest(ready.ipcPath, "health");
  if (health.type !== "res" || !health.result?.healthy) {
    throw new Error(`IPC health failed: ${JSON.stringify(health)}`);
  }

  child.kill("SIGTERM");
  const exit = await waitForExit(child);
  if (exit.signal !== "SIGTERM" && exit.code !== 0) {
    throw new Error(
      `expected clean shutdown, got code=${exit.code} signal=${exit.signal}`,
    );
  }

  console.log(
    "OK: service host READY → IPC ping+health → clean SIGTERM exit",
  );
} catch (error) {
  try {
    child.kill("SIGKILL");
  } catch {
    // already dead
  }
  fail(error instanceof Error ? error.message : error);
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
