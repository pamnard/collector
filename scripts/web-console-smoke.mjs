/**
 * Web console smoke (#529).
 *
 * Opens the canonical web stand at :1420 in Chromium. Fails on any
 * browser console.error / pageerror, or if [data-smoke-shell] never appears.
 *
 * - If :1420 is already up → use it (do not kill/restart).
 * - If :1420 is down → start `vite` on 1420 and leave it running.
 * - Never starts a second Vite on another port.
 * - Never stops Vite (cleanup = close Playwright only).
 *
 *   npm run test:web-console
 *   node scripts/web-console-smoke.mjs --self-check
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STAND_URL = process.env.WEB_SMOKE_URL?.trim() || "http://127.0.0.1:1420/";
const STAND_PORT = 1420;
const READY_TIMEOUT_MS = 60_000;
const SHELL_TIMEOUT_MS = 45_000;
const SHELL_SELECTOR = "[data-smoke-shell]";
const SELF_CHECK = process.argv.includes("--self-check");

function fail(message, details) {
  console.error("FAIL:", message);
  if (details) {
    console.error(details);
  }
  process.exitCode = 1;
}

async function probeStand(url) {
  try {
    const res = await fetch(url, { redirect: "manual" });
    // Any HTTP response means the server is accepting connections.
    void res.body?.cancel?.();
    return true;
  } catch {
    return false;
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function waitForStand(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeStand(url)) {
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for stand at ${url}`);
}

async function ensureStand() {
  if (await probeStand(STAND_URL)) {
    console.log(`OK: using existing stand ${STAND_URL}`);
    return;
  }

  if (!(await portFree(STAND_PORT))) {
    throw new Error(
      `port ${STAND_PORT} is occupied but ${STAND_URL} did not respond — fix the listener; smoke will not steal it`,
    );
  }

  console.log(`stand down — starting vite on :${STAND_PORT} (will leave running)`);
  const child = spawn(
    "npx",
    ["vite", "--port", String(STAND_PORT), "--strictPort", "--host", "127.0.0.1"],
    {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
      detached: true,
    },
  );
  child.unref();

  child.stdout?.on("data", (chunk) => {
    process.stdout.write(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(chunk);
  });
  child.on("exit", (code, signal) => {
    if (process.exitCode) {
      return;
    }
    console.error(
      `vite exited early (code=${code}, signal=${signal}) before smoke finished probing`,
    );
  });

  await waitForStand(STAND_URL, READY_TIMEOUT_MS);
  console.log(`OK: vite ready at ${STAND_URL}`);
}

function collectPageErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") {
      return;
    }
    errors.push(`console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    errors.push(`pageerror: ${err instanceof Error ? err.message : String(err)}`);
  });
  return errors;
}

async function assertShell(page) {
  const locator = page.locator(SHELL_SELECTOR).first();
  await locator.waitFor({ state: "visible", timeout: SHELL_TIMEOUT_MS });
  const box = await locator.boundingBox();
  if (!box || !(box.width > 0 && box.height > 0)) {
    throw new Error(
      `${SHELL_SELECTOR} visible but zero-size box (${box?.width ?? 0}x${box?.height ?? 0})`,
    );
  }
}

async function runSelfCheck() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = collectPageErrors(page);
    await page.setContent(
      `<!doctype html><html><body><script>console.error("smoke-self-check")</script></body></html>`,
    );
    await page.waitForTimeout(100);
    if (errors.length === 0) {
      fail("self-check expected console.error but collected none");
      return;
    }
    if (!errors.some((line) => line.includes("smoke-self-check"))) {
      fail("self-check did not see smoke-self-check", errors.join("\n"));
      return;
    }
    // Intentional failure: proves the gate trips on console.error.
    fail("self-check caught console error (expected)", errors.join("\n"));
  } finally {
    await browser.close();
  }
}

async function runStandSmoke() {
  await ensureStand();

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = collectPageErrors(page);
    await page.goto(STAND_URL, { waitUntil: "domcontentloaded", timeout: READY_TIMEOUT_MS });
    await assertShell(page);
    // Let late bootstrap / HMR console errors settle briefly.
    await page.waitForTimeout(500);

    if (errors.length > 0) {
      fail("browser reported console errors", errors.join("\n"));
      return;
    }
    console.log(`OK: web console clean at ${STAND_URL} (shell ${SHELL_SELECTOR})`);
  } finally {
    await browser.close();
  }
}

try {
  if (SELF_CHECK) {
    await runSelfCheck();
  } else {
    await runStandSmoke();
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
