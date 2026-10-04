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
  } catch {
    const root = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "..",
      "node_modules",
      "playwright",
    );
    return require(root) as typeof import("playwright");
  }
}

function resolveMermaidBrowserBundle(): string | null {
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
 * Production Chromium print pipeline via Playwright `page.pdf`.
 * Not html2canvas / jsPDF-as-engine.
 */
export function createPlaywrightHtmlToPdf(options?: {
  /** Optional absolute path to Golos Text woff2 for @font-face. */
  golosFontPath?: string;
}): HtmlToPdf {
  return async (html: string): Promise<Uint8Array> => {
    const playwright = resolvePlaywright();
    const browser = await playwright.chromium.launch({
      headless: true,
    });
    try {
      const page = await browser.newPage();
      let documentHtml = html;
      if (options?.golosFontPath) {
        await access(options.golosFontPath);
        const fontUrl = `file://${options.golosFontPath}`;
        documentHtml = html.replace(
          "</style>",
          `@font-face{font-family:"Golos Text";src:url("${fontUrl}") format("woff2");font-weight:400 600;font-display:block;}</style>`,
        );
      }
      await page.setContent(documentHtml, { waitUntil: "load" });

      const hasMermaid = await page.locator("pre.mermaid").count();
      if (hasMermaid > 0) {
        const mermaidPath = resolveMermaidBrowserBundle();
        if (!mermaidPath) {
          throw new Error("mermaid bundle not found for print readiness");
        }
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
      return new Uint8Array(pdf);
    } finally {
      await browser.close();
    }
  };
}
