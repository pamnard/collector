/**
 * Dashboard perf smoke — Playwright runner on OS-level :1420.
 *
 *   npm run test:dashboard-perf
 *   node scripts/dashboard-perf-smoke.mjs
 *
 * Env:
 *   WEB_SMOKE_URL — default http://127.0.0.1:1420/
 *   DASHBOARD_PERF_FOLDER_PATH — force target folder path
 *   DASHBOARD_PERF_MIN_ITEMS — default 30
 *   DASHBOARD_PERF_ITERATIONS — default 3
 */
import { chromium } from "playwright";

const STAND_URL = (process.env.WEB_SMOKE_URL?.trim() || "http://127.0.0.1:1420/").replace(
  /\/?$/,
  "/",
);
const MIN_ITEMS = Number(process.env.DASHBOARD_PERF_MIN_ITEMS ?? "30");
const ITERATIONS = Number(process.env.DASHBOARD_PERF_ITERATIONS ?? "3");
const FORCED_FOLDER = process.env.DASHBOARD_PERF_FOLDER_PATH?.trim() || null;
const READY_TIMEOUT_MS = 60_000;
const RUN_TIMEOUT_MS = 45_000;
const SHELL_SELECTOR = "[data-smoke-shell]";

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
    void res.body?.cancel?.();
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

function median(values) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function summarizeRuns(runs) {
  const byKey = new Map();
  for (const run of runs) {
    const scenarioLabel = run.meta.scenario?.split("|")[0] ?? run.kind;
    const direction =
      run.meta.scenario?.includes("grid-to-table") ||
      run.meta.scenario?.includes("table-to-grid")
        ? run.meta.scenario.split("|")[1]
        : null;
    const key = direction
      ? `${scenarioLabel}|${direction}`
      : `${scenarioLabel}|${run.meta.viewMode}`;
    if (!byKey.has(key)) {
      byKey.set(key, []);
    }
    byKey.get(key).push(run);
  }
  const summary = [];
  for (const [key, group] of byKey) {
    summary.push({
      key,
      n: group.length,
      l1Med: median(group.map((r) => r.l1Ms).filter((v) => v != null)),
      l2Med: median(group.map((r) => r.l2Ms).filter((v) => v != null)),
      l3Med: median(group.map((r) => r.l3Ms).filter((v) => v != null)),
      queryMed: median(
        group.map((r) => r.phases.queryIndex).filter((v) => v != null),
      ),
      hydrateMed: median(
        group.map((r) => r.phases.applyIndexPage).filter((v) => v != null),
      ),
      coversMed: median(
        group.map((r) => r.phases.coverFlight).filter((v) => v != null),
      ),
      gridLayoutMed: median(
        group.map((r) => r.phases.gridLayout).filter((v) => v != null),
      ),
      tableMountMed: median(
        group.map((r) => r.phases.tableMount).filter((v) => v != null),
      ),
      intersectCleared: group.some((r) => r.intersectClearedCommitted === true),
    });
  }
  return summary;
}

async function ensureCollectionsPanel(page) {
  const collectionsBtn = page.getByRole("button", { name: "Коллекции" });
  if (await collectionsBtn.count()) {
    await collectionsBtn.first().click();
  }
}

async function listFolders(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll("[data-dashboard-folder-path]")];
    return rows.map((btn) => {
      const path = btn.getAttribute("data-dashboard-folder-path") ?? "";
      const badge = btn.querySelector(".tabular-nums");
      const count = Number.parseInt(badge?.textContent?.trim() ?? "0", 10);
      return { path, count: Number.isFinite(count) ? count : 0 };
    });
  });
}

async function clickFolder(page, folderPath) {
  await page.waitForFunction(
    (path) =>
      [...document.querySelectorAll("[data-dashboard-folder-path]")].some(
        (el) => el.getAttribute("data-dashboard-folder-path") === path,
      ),
    folderPath,
    { timeout: READY_TIMEOUT_MS },
  );
  await page.evaluate((path) => {
    const buttons = document.querySelectorAll("[data-dashboard-folder-path]");
    for (const el of buttons) {
      if (el.getAttribute("data-dashboard-folder-path") === path) {
        if (!(el instanceof HTMLElement)) {
          throw new Error(`folder node is not clickable: ${path}`);
        }
        el.scrollIntoView({ block: "center" });
        el.click();
        return;
      }
    }
    throw new Error(`folder button not found: ${path}`);
  }, folderPath);
}

async function setViewMode(page, mode) {
  const label = mode === "grid" ? "Сетка" : "Таблица";
  await page.getByRole("button", { name: label, exact: true }).click();
}

async function setScenario(page, scenario) {
  await page.evaluate((name) => {
    window.__collectorDashboardPerf?.setNextScenario(name);
  }, scenario);
}

async function waitForLatestRun(page) {
  return page.evaluate(
    async ({ timeoutMs }) => {
      const bridge = window.__collectorDashboardPerf;
      if (!bridge) {
        throw new Error("dashboard perf bridge missing — use ?dashboardPerf=1");
      }
      const deadline = Date.now() + timeoutMs;
      let lastSeen = null;
      while (Date.now() < deadline) {
        const runs = bridge.dump();
        const last = runs[runs.length - 1];
        if (last && last.runId !== lastSeen) {
          lastSeen = last.runId;
          if (last.status !== "running") {
            return last;
          }
          try {
            return await bridge.waitForRun(
              last.runId,
              Math.max(500, deadline - Date.now()),
            );
          } catch {
            // continue polling
          }
        }
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      throw new Error("timed out waiting for dashboard perf run");
    },
    { timeoutMs: RUN_TIMEOUT_MS },
  );
}

async function assertShell(page) {
  const locator = page.locator(SHELL_SELECTOR).first();
  await locator.waitFor({ state: "visible", timeout: READY_TIMEOUT_MS });
}

function pickFolders(folders) {
  const eligible = folders.filter((f) => f.count >= MIN_ITEMS);
  if (FORCED_FOLDER) {
    const target = folders.find((f) => f.path === FORCED_FOLDER);
    if (!target) {
      throw new Error(`DASHBOARD_PERF_FOLDER_PATH not found: ${FORCED_FOLDER}`);
    }
    const small = folders
      .filter((f) => f.path !== target.path)
      .sort((a, b) => a.count - b.count)[0];
    return { target, small: small ?? target };
  }
  if (!eligible.length) {
    throw new Error(
      `no folder with >= ${MIN_ITEMS} items (found ${folders.length} folders)`,
    );
  }
  const target = eligible.sort((a, b) => b.count - a.count)[0];
  const small =
    folders
      .filter((f) => f.path !== target.path)
      .sort((a, b) => a.count - b.count)[0] ?? target;
  return { target, small };
}

async function runFolderSwitch(page, { small, target, mode, scenario }) {
  await setScenario(page, scenario);
  await setViewMode(page, mode);
  await ensureCollectionsPanel(page);
  await clickFolder(page, small.path);
  await waitForLatestRun(page);
  await setScenario(page, scenario);
  await ensureCollectionsPanel(page);
  await clickFolder(page, target.path);
  return waitForLatestRun(page);
}

async function runViewModeSwitch(page, { target, from, to, scenario }) {
  await ensureCollectionsPanel(page);
  await clickFolder(page, target.path);
  await waitForLatestRun(page);
  await setScenario(page, scenario);
  await setViewMode(page, from);
  await waitForLatestRun(page);
  await setScenario(page, scenario);
  await setViewMode(page, to);
  return waitForLatestRun(page);
}

async function main() {
  if (!(await probeStand(STAND_URL))) {
    fail(
      `stand not reachable at ${STAND_URL} — raise OS-level Collector on :1420 first`,
    );
    return;
  }

  const perfUrl = `${STAND_URL}?dashboardPerf=1`;
  const browser = await chromium.launch({ headless: true });
  const collected = [];

  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(perfUrl, { waitUntil: "domcontentloaded", timeout: READY_TIMEOUT_MS });
    await assertShell(page);
    await ensureCollectionsPanel(page);
    await page.waitForSelector("[data-dashboard-folder-path]", {
      timeout: READY_TIMEOUT_MS,
    });

    const folders = await listFolders(page);
    const { target, small } = pickFolders(folders);
    console.log(
      `OK: target folder items>=${MIN_ITEMS} path=${target.path} count=${target.count}; small=${small.path} count=${small.count}`,
    );

    for (let i = 0; i < ITERATIONS; i += 1) {
      collected.push(
        await runFolderSwitch(page, {
          small,
          target,
          mode: "grid",
          scenario: `A-cold|grid|${i}`,
        }),
      );
      collected.push(
        await runFolderSwitch(page, {
          small,
          target,
          mode: "table",
          scenario: `A-cold|table|${i}`,
        }),
      );
      await ensureCollectionsPanel(page);
      await clickFolder(page, small.path);
      await waitForLatestRun(page);
      await setScenario(page, `A-warm|grid|${i}`);
      await setViewMode(page, "grid");
      await waitForLatestRun(page);
      await setScenario(page, `A-warm|grid|${i}`);
      await ensureCollectionsPanel(page);
      await clickFolder(page, target.path);
      collected.push(await waitForLatestRun(page));
      collected.push(
        await runViewModeSwitch(page, {
          target,
          from: "table",
          to: "grid",
          scenario: `B|table-to-grid|${i}`,
        }),
      );
      collected.push(
        await runViewModeSwitch(page, {
          target,
          from: "grid",
          to: "table",
          scenario: `B|grid-to-table|${i}`,
        }),
      );
    }

    const summary = summarizeRuns(collected);
    const payload = { standUrl: STAND_URL, target, small, runs: collected, summary };
    console.log(JSON.stringify(payload, null, 2));
  } finally {
    await browser.close();
  }
}

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
