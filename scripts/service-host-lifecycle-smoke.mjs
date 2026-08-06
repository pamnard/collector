/**
 * Domain host lifecycle / sole-writer smoke (#554).
 *
 * 1. First `serve` → READY + /ping
 * 2. Second `serve` on same data-dir → exit 3 (lock held)
 * 3. SIGTERM first → lock file removed
 * 4. Third `serve` → READY again
 *
 *   npm run test:service-host-lifecycle
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { waitForServiceReady } from "./lib/wait-for-service-ready.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages/service/dist/host/cli.js");
const READY_TIMEOUT_MS = 30_000;
const LOCK_NAME = "collector-service.lock";

function fail(message) {
  console.error("FAIL:", message);
  process.exitCode = 1;
}

function spawnServe(dataDir, env = process.env) {
  return spawn(
    process.execPath,
    [CLI, "serve", "--data-dir", dataDir, "--port", "0"],
    {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    },
  );
}

async function waitForReady(child) {
  return waitForServiceReady(child, { timeoutMs: READY_TIMEOUT_MS });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.on("exit", (code, signal) => {
      resolve({ code, signal });
    });
    child.on("error", reject);
  });
}

async function waitForExitCode(child) {
  // Drain stderr so the process can exit.
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });
  child.stdout.on("data", () => {});
  return waitForExit(child);
}

const dataDir = mkdtempSync(join(tmpdir(), "collector-service-lifecycle-"));
const lockPath = join(dataDir, LOCK_NAME);
let first;
let third;

try {
  first = spawnServe(dataDir, {
    ...process.env,
    COLLECTOR_SERVICE_SUPERVISOR_PID: String(process.pid),
  });
  const ready = await waitForReady(first);
  if (!ready?.baseUrl) {
    throw new Error(`invalid READY payload: ${JSON.stringify(ready)}`);
  }
  if (!existsSync(lockPath)) {
    throw new Error("lock file missing after READY");
  }

  const ping = await fetch(`${ready.baseUrl}/ping`);
  if (!ping.ok) {
    throw new Error(`/ping status ${ping.status}`);
  }

  const second = spawnServe(dataDir, {
    ...process.env,
    COLLECTOR_SERVICE_SUPERVISOR_PID: String(process.pid),
  });
  const secondExit = await waitForExitCode(second);
  if (secondExit.code !== 3) {
    throw new Error(
      `second serve expected exit 3 (lock), got code=${secondExit.code} signal=${secondExit.signal}`,
    );
  }

  first.kill("SIGTERM");
  const firstExit = await waitForExit(first);
  if (firstExit.signal !== "SIGTERM" && firstExit.code !== 0) {
    throw new Error(
      `first host unclean exit code=${firstExit.code} signal=${firstExit.signal}`,
    );
  }

  const lockGoneDeadline = Date.now() + 5000;
  while (existsSync(lockPath) && Date.now() < lockGoneDeadline) {
    await new Promise((r) => setTimeout(r, 25));
  }
  if (existsSync(lockPath)) {
    throw new Error("lock file still present after SIGTERM");
  }

  third = spawnServe(dataDir, {
    ...process.env,
    COLLECTOR_SERVICE_SUPERVISOR_PID: String(process.pid),
  });
  const readyAgain = await waitForReady(third);
  if (!readyAgain?.baseUrl) {
    throw new Error(`third READY invalid: ${JSON.stringify(readyAgain)}`);
  }
  if (!existsSync(lockPath)) {
    throw new Error("lock file missing after third READY");
  }

  third.kill("SIGTERM");
  const thirdExit = await waitForExit(third);
  if (thirdExit.signal !== "SIGTERM" && thirdExit.code !== 0) {
    throw new Error(
      `third host unclean exit code=${thirdExit.code} signal=${thirdExit.signal}`,
    );
  }

  console.log(
    "OK: sole-writer lock — first READY, second exit 3, stop clears lock, third READY",
  );
} catch (error) {
  for (const child of [first, third]) {
    if (!child) {
      continue;
    }
    try {
      child.kill("SIGKILL");
    } catch {
      // already dead
    }
  }
  fail(error instanceof Error ? error.message : error);
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
