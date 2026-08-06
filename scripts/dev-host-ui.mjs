#!/usr/bin/env node
/**
 * Non-Tauri launcher: domain host + Vite UI with VITE_* handoff (#554).
 *
 * Usage:
 *   npm run build:packages
 *   node scripts/dev-host-ui.mjs --data-dir <vault-data> [--config-dir <dir>] [--port 0] [--ui-port 1420]
 *
 * Or: COLLECTOR_DATA_DIR=… node scripts/dev-host-ui.mjs
 *
 * Does not kill an occupied UI port — fail loudly and pass --ui-port.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages/service/dist/host/cli.js");
const READY_PREFIX = "COLLECTOR_SERVICE_READY ";
const TOKEN_FILE = "collector-service.host-token";
const READY_TIMEOUT_MS = 60_000;
const DEFAULT_UI_PORT = 1420;

function usage(message) {
  if (message) {
    console.error(message);
  }
  console.error(
    "Usage: node scripts/dev-host-ui.mjs --data-dir <path> [--config-dir <path>] [--port 0] [--ui-port 1420]\n" +
      "   or: COLLECTOR_DATA_DIR=<path> node scripts/dev-host-ui.mjs [options]",
  );
  process.exit(2);
}

function readArg(argv, name) {
  const idx = argv.indexOf(name);
  if (idx < 0) {
    return undefined;
  }
  return argv[idx + 1];
}

function portInUse(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
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
      console.log(line);
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

function waitForExit(child, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve({
        code: child?.exitCode ?? null,
        signal: child?.signalCode ?? null,
      });
      return;
    }
    const timer = setTimeout(() => {
      resolve({ code: child.exitCode, signal: child.signalCode });
    }, timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function stopChild(child, label) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const pid = child.pid;
  try {
    child.kill("SIGTERM");
  } catch {
    // already gone
  }
  await waitForExit(child, 3000);
  if (child.exitCode === null && child.signalCode === null && pid) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
    await waitForExit(child, 1000);
  }
  console.error(`[dev-host-ui] stopped ${label} pid=${pid ?? "?"}`);
}

async function main(argv) {
  if (!existsSync(CLI)) {
    usage(
      `Missing ${CLI}. Run: npm run build:packages`,
    );
  }

  const dataDir = readArg(argv, "--data-dir") ?? process.env.COLLECTOR_DATA_DIR;
  if (!dataDir || !String(dataDir).trim()) {
    usage("Missing --data-dir / COLLECTOR_DATA_DIR");
  }

  const configDir = readArg(argv, "--config-dir");
  const hostPortRaw = readArg(argv, "--port");
  const uiPortRaw = readArg(argv, "--ui-port");
  const uiPort =
    uiPortRaw === undefined ? DEFAULT_UI_PORT : Number(uiPortRaw);
  if (!Number.isInteger(uiPort) || uiPort <= 0) {
    usage("Invalid --ui-port");
  }

  if (await portInUse(uiPort)) {
    console.error(
      `UI port ${uiPort} is already in use. Pass --ui-port <free-port> (will not kill the existing stand).`,
    );
    process.exit(1);
  }

  const hostArgs = [CLI, "serve", "--data-dir", dataDir, "--port"];
  hostArgs.push(hostPortRaw ?? "0");
  if (configDir) {
    hostArgs.push("--config-dir", configDir);
  }

  const host = spawn(process.execPath, hostArgs, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      COLLECTOR_SERVICE_SUPERVISOR_PID: String(process.pid),
    },
  });

  let vite = null;
  let shuttingDown = false;

  const shutdown = async (reason) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.error(`[dev-host-ui] shutting down (${reason})`);
    await stopChild(vite, "vite");
    await stopChild(host, "host");
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  // npm may send SIGHUP when the wrapper dies; still tear down children.
  process.once("SIGHUP", () => {
    void shutdown("SIGHUP");
  });

  const ready = await waitForReady(host);
  if (!ready?.baseUrl) {
    throw new Error(`invalid READY: ${JSON.stringify(ready)}`);
  }

  const tokenPath = join(dataDir, TOKEN_FILE);
  if (!existsSync(tokenPath)) {
    throw new Error(`host token file missing: ${tokenPath}`);
  }
  const token = readFileSync(tokenPath, "utf8").trim();
  if (!token) {
    throw new Error(`host token file empty: ${tokenPath}`);
  }

  console.error(
    `[dev-host-ui] host READY ${ready.baseUrl}; starting Vite on :${uiPort}`,
  );
  console.error(
    `[dev-host-ui] MCP: collector-mcp --base-url ${ready.baseUrl} --data-dir ${dataDir}`,
  );

  vite = spawn(
    process.execPath,
    [
      join(ROOT, "node_modules/vite/bin/vite.js"),
      "--port",
      String(uiPort),
      "--strictPort",
      "--host",
      "127.0.0.1",
    ],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        VITE_COLLECTOR_SERVICE_BASE_URL: ready.baseUrl,
        VITE_COLLECTOR_SERVICE_TOKEN: token,
      },
    },
  );

  vite.on("exit", (code, signal) => {
    void shutdown(`vite exit code=${code} signal=${signal}`);
  });
  host.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(
        `[dev-host-ui] host exited unexpectedly code=${code} signal=${signal}`,
      );
      void shutdown("host exit");
    }
  });
}

main(process.argv.slice(2)).catch((error) => {
  console.error(
    "[dev-host-ui] fatal:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
