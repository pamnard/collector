/**
 * Chromium print-to-PDF port for item export (#304).
 * Production uses Playwright; offline tests inject a mock.
 */

import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type HtmlToPdf = (html: string) => Promise<Uint8Array>;

const PRINT_READY_TIMEOUT_MS = 60_000;

function resolvePlaywright(): typeof import("playwright") {
  const require = createRequire(import.meta.url);
  try {
    return require("playwright") as typeof import("playwright");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `playwright is required for htmlToPdf on the host: ${message}`,
    );
  }
}

function resolveMermaidBrowserBundle(): string {
  const require = createRequire(import.meta.url);
  try {
    return require.resolve("mermaid/dist/mermaid.min.js");
  } catch {
    const root = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "..",
      "node_modules",
      "mermaid",
      "dist",
      "mermaid.min.js",
    );
    return root;
  }
}

async function waitForPrintReady(
  page: import("playwright").Page,
): Promise<void> {
  await page.waitForFunction(
    async () => {
      if (document.fonts && document.fonts.status !== "loaded") {
        await document.fonts.ready;
      }
      const images = Array.from(document.images);
      if (images.some((img) => !img.complete)) {
        return false;
      }
      if (images.some((img) => img.naturalWidth === 0 && img.src)) {
        return false;
      }
      const mermaidNodes = document.querySelectorAll(
        "pre.mermaid, .mermaid",
      );
      for (const node of mermaidNodes) {
        // After mermaid.run, source pre is replaced or contains svg.
        if (node.tagName === "PRE" && !node.querySelector("svg")) {
          return false;
        }
        if (
          node.classList.contains("mermaid") &&
          node.tagName !== "PRE" &&
          !node.querySelector("svg")
        ) {
          return false;
        }
      }
      if (document.querySelectorAll(".katex-error").length > 0) {
        return false;
      }
      return true;
    },
    { timeout: PRINT_READY_TIMEOUT_MS },
  );
}

/**
 * Fail loudly at job start when Playwright/Chromium is missing so the job
 * never reports success with an empty or absent PDF.
 */
export async function assertPlaywrightChromiumReady(): Promise<void> {
  const playwright = resolvePlaywright();
  const executablePath = playwright.chromium.executablePath();
  try {
    await access(executablePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Playwright Chromium cannot launch for PDF export: executable missing at ${executablePath} (${message})`,
    );
  }
}

/**
 * Production Chromium print pipeline via Playwright `page.pdf`.
 * Not html2canvas / jsPDF-as-engine.
 */
export function createPlaywrightHtmlToPdf(): HtmlToPdf {
  return async (html: string): Promise<Uint8Array> => {
    const playwright = resolvePlaywright();
    let browser: import("playwright").Browser;
    try {
      browser = await playwright.chromium.launch({
        headless: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Playwright Chromium cannot launch for PDF export: ${message}`,
      );
    }
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });

      const hasMermaid = await page.locator("pre.mermaid").count();
      if (hasMermaid > 0) {
        const mermaidPath = resolveMermaidBrowserBundle();
        await access(mermaidPath);
        await page.addScriptTag({ path: mermaidPath });
        await page.evaluate(async () => {
          const mermaid = (
            window as unknown as {
              mermaid: {
                initialize: (config: Record<string, unknown>) => void;
                run: (opts?: { querySelector?: string }) => Promise<void>;
              };
            }
          ).mermaid;
          mermaid.initialize({
            startOnLoad: false,
            theme: "neutral",
            securityLevel: "strict",
          });
          await mermaid.run({ querySelector: "pre.mermaid" });
        });
      }

      await waitForPrintReady(page);
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
      });
      if (pdf.byteLength === 0) {
        throw new Error("Playwright page.pdf returned empty PDF");
      }
      return new Uint8Array(pdf);
    } finally {
      await browser.close();
    }
  };
}
