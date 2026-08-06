/**
 * Out-of-band service host health smoke (#151 / #551).
 *
 * Spawns `collector-service serve` against a temp data dir, waits for READY,
 * checks /ping + Bearer /health, then SIGTERM for a clean exit.
 *
 * Local / CI:
 *   npm run test:service-host
 *
 * Also run from `npm run verify:release` (startup smokes section).
 * Must never be started by the Tauri app (sole SQLite writer stays in-process).
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages/service/dist/host/cli.js");
const READY_PREFIX = "COLLECTOR_SERVICE_READY ";
const READY_TIMEOUT_MS = 30_000;

function fail(message) {
  console.error("FAIL:", message);
  process.exitCode = 1;
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

const dataDir = mkdtempSync(join(tmpdir(), "collector-service-host-smoke-"));
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
  if (!ready?.baseUrl || !ready?.port) {
    throw new Error(`invalid READY payload: ${JSON.stringify(ready)}`);
  }
  if (!ready?.wsEventsUrl) {
    throw new Error(`READY missing wsEventsUrl: ${JSON.stringify(ready)}`);
  }

  const ping = await fetch(`${ready.baseUrl}/ping`);
  if (!ping.ok) {
    throw new Error(`/ping status ${ping.status}`);
  }
  const pingBody = await ping.json();
  if (!pingBody?.pong) {
    throw new Error(`/ping body ${JSON.stringify(pingBody)}`);
  }

  const token = readFileSync(
    join(dataDir, "collector-service.host-token"),
    "utf8",
  ).trim();
  if (!token) {
    throw new Error("host token file empty");
  }

  const healthBare = await fetch(`${ready.baseUrl}/health`);
  if (healthBare.status !== 401) {
    throw new Error(
      `/health without Bearer expected 401, got ${healthBare.status}`,
    );
  }

  const health = await fetch(`${ready.baseUrl}/health`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!health.ok) {
    throw new Error(`/health status ${health.status}`);
  }
  const healthBody = await health.json();
  if (!healthBody?.healthy) {
    throw new Error(`/health body ${JSON.stringify(healthBody)}`);
  }

  child.kill("SIGTERM");
  const exit = await waitForExit(child);
  if (exit.signal !== "SIGTERM" && exit.code !== 0) {
    throw new Error(
      `expected clean shutdown, got code=${exit.code} signal=${exit.signal}`,
    );
  }

  console.log(
    "OK: service host READY → /ping + /health (Bearer) healthy → clean SIGTERM exit",
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
