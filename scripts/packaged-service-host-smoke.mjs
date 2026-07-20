/**
 * Isolated packaged-host smoke: prove domain host works WITHOUT monorepo ancestry.
 *
 * Copies release sidecar + resources/collector-service-host into /tmp, then:
 * 1. ABI probe: bundled node require('better-sqlite3')
 * 2. collector-service serve → COLLECTOR_SERVICE_READY
 *
 * Usage:
 *   node scripts/packaged-service-host-smoke.mjs \
 *     /path/to/collector-service \
 *     /path/to/resources/collector-service-host
 */
import {
  cpSync,
  existsSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const sidecarSrc = process.argv[2] && resolve(process.argv[2]);
const hostSrc = process.argv[3] && resolve(process.argv[3]);

if (!sidecarSrc || !hostSrc) {
  console.error(
    "Usage: node scripts/packaged-service-host-smoke.mjs <collector-service> <collector-service-host-dir>",
  );
  process.exit(1);
}

function fail(msg, details) {
  console.error(`FAIL: ${msg}`);
  if (details) console.error(details);
  process.exit(1);
}

if (!existsSync(sidecarSrc)) fail(`sidecar missing: ${sidecarSrc}`);
if (!existsSync(join(hostSrc, "cli.js"))) {
  fail(`packaged host marker missing: ${join(hostSrc, "cli.js")}`);
}

const isWin = process.platform === "win32";
const nodeName = isWin ? "node.exe" : "node";
if (!existsSync(join(hostSrc, nodeName))) {
  fail(`bundled node missing: ${join(hostSrc, nodeName)}`);
}
if (!existsSync(join(hostSrc, "node_modules", "better-sqlite3"))) {
  fail(`better-sqlite3 missing under ${hostSrc}`);
}
if (!existsSync(join(hostSrc, "node_modules", "sharp"))) {
  fail(`sharp missing under ${hostSrc}`);
}

const root = mkdtempSync(join(tmpdir(), "collector-packaged-host-"));
const binDir = join(root, "bin");
const resourcesDir = join(root, "resources");
const hostDir = join(resourcesDir, "collector-service-host");
const dataDir = join(root, "data");
mkdirSync(binDir, { recursive: true });
mkdirSync(resourcesDir, { recursive: true });
mkdirSync(dataDir, { recursive: true });

const sidecarDest = join(binDir, isWin ? "collector-service.exe" : "collector-service");
cpSync(sidecarSrc, sidecarDest);
cpSync(hostSrc, hostDir, { recursive: true });

const repoMarker = join(root, "packages", "service", "dist", "host", "cli.js");
if (existsSync(repoMarker)) {
  fail("isolated tree unexpectedly contains monorepo host path");
}

const nodeBin = join(hostDir, nodeName);
const cliJs = join(hostDir, "cli.js");


console.log("==> Linux deb layout marker (resource_dir/resources/host)");
const linuxRoot = join(root, "lib", "Collector");
const linuxHost = join(linuxRoot, "resources", "collector-service-host");
mkdirSync(linuxHost, { recursive: true });
cpSync(hostSrc, linuxHost, { recursive: true });
const linuxCli = join(linuxHost, "cli.js");
const linuxNode = join(linuxHost, nodeName);
if (!existsSync(linuxCli) || !existsSync(linuxNode)) {
  fail("linux deb layout copy incomplete");
}
// Contract: candidates are root/collector-service-host/cli.js OR
// root/resources/collector-service-host/cli.js where root === resource_dir.
if (!existsSync(join(linuxRoot, "resources", "collector-service-host", "cli.js"))) {
  fail("linux resource_dir candidate missing");
}
if (existsSync(join(linuxRoot, "collector-service-host", "cli.js"))) {
  fail("unexpected flat host under lib/Collector (should be under resources/)");
}
console.log("==> ABI probe (bundled node + better-sqlite3 + sharp)");
await new Promise((resolvePromise, rejectPromise) => {
  const child = spawn(nodeBin, ["-e", "require('better-sqlite3')(':memory:'); require('sharp'); console.log('ok')"], {
    cwd: hostDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (c) => (out += c));
  child.stderr.on("data", (c) => (err += c));
  child.on("error", rejectPromise);
  child.on("exit", (code) => {
    if (code === 0 && out.includes("ok")) resolvePromise();
    else rejectPromise(new Error(`ABI probe failed code=${code}\n${out}\n${err}`));
  });
}).catch((e) => fail(e.message));

console.log("==> collector-service serve (isolated, env inject)");
const logPath = join(dataDir, "serve.log");
writeFileSync(logPath, "");

const READY_MS = 20_000;
const ready = await new Promise((resolvePromise) => {
  const child = spawn(sidecarDest, ["serve", "--data-dir", dataDir], {
    cwd: binDir,
    env: {
      ...process.env,
      COLLECTOR_SERVICE_NODE_CLI: cliJs,
      COLLECTOR_SERVICE_NODE: nodeBin,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let body = "";
  const onChunk = (c) => {
    body += c.toString();
    writeFileSync(logPath, body);
    if (body.includes("COLLECTOR_SERVICE_READY ")) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      resolvePromise({ ok: true, body });
    }
  };
  child.stdout.on("data", onChunk);
  child.stderr.on("data", onChunk);
  child.on("error", (err) => resolvePromise({ ok: false, body: String(err) }));
  child.on("exit", () => {
    if (!body.includes("COLLECTOR_SERVICE_READY ")) {
      resolvePromise({ ok: false, body });
    }
  });
  setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    resolvePromise({
      ok: body.includes("COLLECTOR_SERVICE_READY "),
      body,
    });
  }, READY_MS);
});

rmSync(root, { recursive: true, force: true });

if (!ready.ok) {
  fail(
    "isolated collector-service did not print COLLECTOR_SERVICE_READY",
    ready.body || "(empty)",
  );
}

console.log("OK: packaged service host smoke (ABI + READY outside monorepo)");
