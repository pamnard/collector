/**
 * Local IPC transport smoke (#152/#336).
 *
 * Spawns `collector-service serve`, dials the READY `ipcPath` with auth token
 * from dataDir, runs health/ping over framed IPC, then SIGTERM for a clean exit.
 *
 * Local / CI:
 *   npm run test:service-ipc
 *
 * Also run from `npm run verify:release`.
 */
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

function readToken(dataDir) {
  return readFileSync(join(dataDir, "collector-service.ipc-token"), "utf8").trim();
}

function ipcRequest(path, method, params) {
  return new Promise((resolve, reject) => {
    const id = "1";
    const socket = createConnection({ path }, () => {
      socket.write(
        encodeFrame({
          v: PROTOCOL_VERSION,
          id,
          type: "req",
          method,
          ...(params === undefined ? {} : { params }),
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

/** One connection: auth, then sequential requests, then close. */
function ipcAuthedRequests(path, token, methods) {
  return new Promise((resolve, reject) => {
    const results = [];
    let nextId = 1;
    let queue = [{ method: "auth", params: { token } }, ...methods];
    let pendingId = null;
    let buf = Buffer.alloc(0);

    const sendNext = (socket) => {
      if (queue.length === 0) {
        socket.end();
        resolve(results);
        return;
      }
      const next = queue.shift();
      pendingId = String(nextId++);
      socket.write(
        encodeFrame({
          v: PROTOCOL_VERSION,
          id: pendingId,
          type: "req",
          method: next.method,
          ...(next.params === undefined ? {} : { params: next.params }),
        }),
      );
    };

    const socket = createConnection({ path }, () => sendNext(socket));
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("IPC session timed out"));
    }, 15_000);

    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (buf.length < 4 + len) return;
        const message = JSON.parse(buf.subarray(4, 4 + len).toString("utf8"));
        buf = buf.subarray(4 + len);
        if (message.id !== pendingId) continue;
        results.push(message);
        if (message.type === "err") {
          clearTimeout(timer);
          socket.destroy();
          reject(new Error(`IPC error: ${JSON.stringify(message)}`));
          return;
        }
        sendNext(socket);
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("close", () => clearTimeout(timer));
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

  const token = readToken(dataDir);
  const unauth = await ipcRequest(ready.ipcPath, "ping");
  if (unauth.type !== "err" || unauth.error?.code !== "auth_required") {
    throw new Error(`expected auth_required, got ${JSON.stringify(unauth)}`);
  }

  const results = await ipcAuthedRequests(ready.ipcPath, token, [
    { method: "ping" },
    { method: "health" },
  ]);
  const auth = results[0];
  const ping = results[1];
  const health = results[2];
  if (auth?.type !== "res") {
    throw new Error(`IPC auth failed: ${JSON.stringify(auth)}`);
  }
  if (ping?.type !== "res" || !ping.result?.pong) {
    throw new Error(`IPC ping failed: ${JSON.stringify(ping)}`);
  }
  if (health?.type !== "res" || !health.result?.healthy) {
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
    "OK: service host READY → IPC auth_required + auth+ping+health → clean SIGTERM exit",
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
