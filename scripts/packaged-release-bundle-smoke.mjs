/**
 * Packaged release bundle smoke (#555): host + static UI without Tauri/sidecar.
 *
 * Expects dist/collector-release/ from prepare-release-bundle.sh.
 * Spawns bundled node cli.js with --ui-dir, checks /ping, /api/ui-bootstrap, /.
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { waitForServiceReady } from "./lib/wait-for-service-ready.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE_ROOT = resolve(
  process.env.COLLECTOR_RELEASE_ROOT ?? join(ROOT, "dist/collector-release"),
);
const HOST_DIR = join(RELEASE_ROOT, "collector-service-host");
const UI_DIR = join(RELEASE_ROOT, "ui");
const READY_TIMEOUT_MS = 90_000;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const isWin = process.platform === "win32";
const nodeName = isWin ? "node.exe" : "node";
const nodeBin = join(HOST_DIR, nodeName);
const cliJs = join(HOST_DIR, "cli.js");

if (!existsSync(cliJs)) fail(`host cli.js missing: ${cliJs}`);
if (!existsSync(nodeBin)) fail(`bundled node missing: ${nodeBin}`);
if (!existsSync(join(UI_DIR, "index.html"))) {
  fail(`ui/index.html missing: ${UI_DIR}`);
}

const dataDir = mkdtempSync(join(tmpdir(), "collector-release-smoke-"));
const child = spawn(
  nodeBin,
  [
    cliJs,
    "serve",
    "--data-dir",
    dataDir,
    "--port",
    "0",
    "--host",
    "127.0.0.1",
    "--ui-dir",
    UI_DIR,
  ],
  {
    cwd: HOST_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  },
);

function cleanup() {
  try {
    child.kill("SIGTERM");
  } catch {
    // ignore
  }
  rmSync(dataDir, { recursive: true, force: true });
}

process.on("exit", cleanup);

const ready = await waitForServiceReady(child, {
  timeoutMs: READY_TIMEOUT_MS,
  echoStdout: true,
});

const baseUrl = ready.baseUrl;
if (!baseUrl) fail("READY missing baseUrl");

const ping = await fetch(`${baseUrl}/ping`);
if (ping.status !== 200) fail(`/ping status ${ping.status}`);

const bootstrap = await fetch(`${baseUrl}/api/ui-bootstrap`);
if (bootstrap.status !== 200) fail(`/api/ui-bootstrap status ${bootstrap.status}`);
const boot = await bootstrap.json();
if (!boot.token || !boot.baseUrl) fail("ui-bootstrap missing token/baseUrl");

const index = await fetch(`${baseUrl}/`);
if (index.status !== 200) fail(`GET / status ${index.status}`);
const html = await index.text();
if (!html.includes("<html") && !html.includes("<!DOCTYPE") && !html.includes("<!doctype")) {
  // vite may emit <!doctype html> lowercase
  if (!html.toLowerCase().includes("html")) {
    fail("GET / did not return HTML");
  }
}

const health = await fetch(`${baseUrl}/health`, {
  headers: { Authorization: `Bearer ${boot.token}` },
});
if (health.status !== 200) fail(`/health status ${health.status}`);

const rpc = await fetch(`${baseUrl}/api/rpc`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${boot.token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ id: "1", method: "getDataDirectory" }),
});
if (rpc.status !== 200) fail(`/api/rpc status ${rpc.status}`);
const rpcBody = await rpc.json();
if (rpcBody.result !== dataDir) {
  fail(`getDataDirectory mismatch: ${JSON.stringify(rpcBody)}`);
}

child.kill("SIGTERM");
await new Promise((r) => setTimeout(r, 500));
rmSync(dataDir, { recursive: true, force: true });

console.log("OK: packaged release bundle smoke passed");
process.exit(0);
