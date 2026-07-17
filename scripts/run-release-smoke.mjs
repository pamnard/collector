/**
 * Headless smoke: run release binary, fail on ANY runtime error.
 *
 * - JS/WebView: app writes to smoke-errors.log when smoke-mode.flag exists
 * - stderr: any non-whitelisted line fails
 * - DB: legacy broken index must be repaired
 *
 * Linux launches via `xvfb-run`. The child is started in its own process group
 * so SIGTERM/SIGKILL reach xvfb-run, Xvfb, and collector — not just the parent.
 */
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { ensureHealthyIndex } from "../packages/db/dist/validate.js";
import { BetterSqliteMigrator } from "../packages/db/dist/testing/better-sqlite.js";
import {
  writeLegacyBrokenIndexDb,
  canonicalIndexPath,
  wrongDataDirIndexPath,
} from "./legacy-index-db.mjs";

const BIN = process.argv[2];
if (!BIN) {
  console.error("Usage: node scripts/run-release-smoke.mjs /path/to/collector");
  process.exit(1);
}

const binary = resolve(BIN);
if (!existsSync(binary)) {
  console.error(`Binary not found: ${binary}`);
  process.exit(1);
}

const profileRoot = mkdtempSync(join(tmpdir(), "collector-release-smoke-"));
const home = join(profileRoot, "home");
mkdirSync(home, { recursive: true });

const env = {
  ...process.env,
  HOME: home,
  XDG_DATA_HOME: join(home, ".local/share"),
  XDG_CONFIG_HOME: join(home, ".config"),
};
delete env.RUSTUP_HOME;
delete env.CARGO_HOME;
mkdirSync(env.XDG_DATA_HOME, { recursive: true });
mkdirSync(env.XDG_CONFIG_HOME, { recursive: true });

const appConfigDir = join(home, ".config/com.collector.app");
mkdirSync(appConfigDir, { recursive: true });
writeFileSync(join(appConfigDir, "smoke-mode.flag"), "1\n");

await writeLegacyBrokenIndexDb(canonicalIndexPath(home));
await writeLegacyBrokenIndexDb(wrongDataDirIndexPath(home));

const logPath = join(profileRoot, "run.log");
const smokeErrorLog = join(appConfigDir, "smoke-errors.log");
const logFd = await import("node:fs/promises").then((fs) =>
  fs.open(logPath, "w"),
);

const RUN_MS = 15_000;
const SHUTDOWN_MS = 8_000;

const STDERR_WHITELIST = [
  /^libEGL warning:/,
  /^libEGL warning: DRI3 error:/,
  /^libEGL warning: Ensure your X server supports DRI3/,
  /DRI3 error: Could not get DRI3 device/,
  /accelerated rendering/,
];

/** Kill the whole process group (xvfb-run → Xvfb + collector). */
function killProcessGroup(child, signal) {
  if (!child?.pid) {
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already exited
    }
  }
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolvePromise(undefined);
    };

    if (child.exitCode !== null || child.signalCode !== null) {
      finish();
      return;
    }

    child.on("error", rejectPromise);
    child.on("exit", finish);

    setTimeout(() => {
      killProcessGroup(child, "SIGKILL");
      finish();
    }, timeoutMs);
  });
}

function launchBinary(command, args, launchEnv = env) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      env: launchEnv,
      stdio: ["ignore", logFd.fd, logFd.fd],
      // Own process group so teardown can signal xvfb-run + grandchildren.
      detached: true,
    });
    child.on("error", rejectPromise);
    child.on("spawn", () => resolvePromise(child));
  });
}

/** Last-resort: kill any still-running copy of this exact release binary. */
function killStrayReleaseBinary() {
  if (process.platform !== "linux") {
    return;
  }
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) {
      continue;
    }
    let exe = "";
    try {
      exe = readlinkSync(`/proc/${name}/exe`);
    } catch {
      continue;
    }
    exe = exe.replace(/ \(deleted\)$/, "");
    if (exe !== binary) {
      continue;
    }
    try {
      process.kill(Number(name), "SIGKILL");
    } catch {
      // gone
    }
  }
}

const isLinux = process.platform === "linux";
// Always headless on Linux — never flash a window on the user's real DISPLAY.
const launchEnv = { ...env };
if (isLinux) {
  delete launchEnv.DISPLAY;
}

let child = null;
let exitCode = 0;

function fail(message, details) {
  console.error(`FAIL: ${message}`);
  if (details) {
    console.error(details);
  }
  exitCode = 1;
}

try {
  child = isLinux
    ? await launchBinary("xvfb-run", ["-a", binary], launchEnv)
    : await launchBinary(binary, [], launchEnv);

  await new Promise((resolvePromise) => setTimeout(resolvePromise, RUN_MS));

  killProcessGroup(child, "SIGTERM");
  await waitForExit(child, SHUTDOWN_MS);
  killProcessGroup(child, "SIGKILL");

  await logFd.close();

  const stderrLog = readFileSync(logPath, "utf8");
  const stderrLines = stderrLog
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !STDERR_WHITELIST.some((re) => re.test(line)));

  if (stderrLines.length > 0) {
    fail(
      "release binary produced stderr output (any non-whitelisted line is a failure)",
      stderrLines.map((line) => `  ${line}`).join("\n"),
    );
  } else if (!existsSync(smokeErrorLog)) {
    fail("smoke-errors.log was not created — error capture did not run");
  } else {
    const jsErrors = readFileSync(smokeErrorLog, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (jsErrors.length > 0) {
      fail(
        "application logged runtime errors (smoke-errors.log)",
        jsErrors.map((line) => `  ${line}`).join("\n"),
      );
    } else {
      const dbPath = canonicalIndexPath(home);
      if (!existsSync(dbPath)) {
        fail(
          "canonical collector.db missing after startup",
          stderrLog.trim() || "(empty stderr)",
        );
      } else {
        const db = BetterSqliteMigrator.open(dbPath);
        const health = await ensureHealthyIndex(db);
        db.close();
        if (!health.ok) {
          fail("index unhealthy after startup", health.errors.join("; "));
        } else {
          console.log("OK: no runtime errors, legacy index repaired");
        }
      }
    }
  }
} finally {
  killProcessGroup(child, "SIGKILL");
  killStrayReleaseBinary();
  try {
    await logFd.close();
  } catch {
    // already closed
  }
  rmSync(profileRoot, { recursive: true, force: true });
}

process.exit(exitCode);
