/**
 * Fast L3 dashboard smoke against existing :1420 (quality-fast-delivery).
 * Usage: node scripts/smoke-dashboard-1420.mjs
 */
import { chromium } from "playwright";

const base = process.env.COLLECTOR_STAND_URL ?? "http://127.0.0.1:1420";

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

try {
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 15000 });
  const shell = page.locator("main, .my-masonry-grid, #root").first();
  await shell.waitFor({ state: "visible", timeout: 15000 });

  const search = page
    .locator(
      'input[type="search"], input[placeholder*="Search" i], input[placeholder*="Поиск" i]',
    )
    .first();
  if ((await search.count()) > 0) {
    await search.fill("a");
    await page.waitForTimeout(400);
    await search.fill("");
    await page.waitForTimeout(400);
  }

  const folders = page.locator('[role="treeitem"], [data-folder-path]');
  if ((await folders.count()) >= 2) {
    await folders.nth(1).click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
    await folders.nth(0).click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
  }

  const body = await page.locator("body").innerText();
  const fatal =
    /CollectorService not installed|StartupError|Something went wrong/i.test(
      body,
    );
  const ok = (await shell.isVisible()) && !fatal && pageErrors.length === 0;
  console.log(JSON.stringify({ ok, fatal, pageErrors: pageErrors.slice(0, 5) }));
  process.exit(ok ? 0 : 1);
} finally {
  await browser.close();
}
