/**
 * Print-document assets: Golos Text faces + KaTeX CSS/fonts (#304).
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const GOLOS_CSS_FILES = ["400.css", "600.css"] as const;

function resolvePackageDir(packageName: string): string {
  const require = createRequire(import.meta.url);
  try {
    return dirname(require.resolve(`${packageName}/package.json`));
  } catch {
    const fallback = join(process.cwd(), "node_modules", ...packageName.split("/"));
    if (!existsSync(join(fallback, "package.json"))) {
      throw new Error(`print asset package not found: ${packageName}`);
    }
    return fallback;
  }
}

/**
 * Build @font-face CSS for Golos Text latin + cyrillic (and ext) at 400/600.
 * Uses the same fontsource CSS the UI loads, with file:// URLs for Chromium.
 */
export function buildGolosTextPrintFontCss(): string {
  const pkgDir = resolvePackageDir("@fontsource/golos-text");
  const requiredWoff2 = [
    "golos-text-latin-400-normal.woff2",
    "golos-text-cyrillic-400-normal.woff2",
    "golos-text-latin-600-normal.woff2",
    "golos-text-cyrillic-600-normal.woff2",
  ];
  for (const name of requiredWoff2) {
    const abs = join(pkgDir, "files", name);
    if (!existsSync(abs)) {
      throw new Error(`Golos Text print font missing: ${name}`);
    }
  }

  const filesRoot = join(pkgDir, "files").replace(/\\/g, "/");
  const chunks: string[] = [];
  for (const cssName of GOLOS_CSS_FILES) {
    const cssPath = join(pkgDir, cssName);
    if (!existsSync(cssPath)) {
      throw new Error(`Golos Text CSS missing: ${cssName}`);
    }
    const raw = readFileSync(cssPath, "utf8");
    const rewritten = raw
      .replace(/url\(\.\/files\//g, `url("file://${filesRoot}/`)
      .replace(/\) format\(/g, `") format(`)
      .replace(/font-display:\s*swap;/g, "font-display: block;");
    chunks.push(rewritten);
  }
  return chunks.join("\n");
}

/**
 * KaTeX stylesheet with font URLs rewritten to absolute file:// paths so
 * Chromium print can load formula glyphs without a network base.
 */
export function buildKatexPrintCss(): string {
  const katexDir = resolvePackageDir("katex");
  const cssPath = join(katexDir, "dist", "katex.min.css");
  if (!existsSync(cssPath)) {
    throw new Error(`KaTeX CSS missing: ${cssPath}`);
  }
  const fontsDir = join(katexDir, "dist", "fonts").replace(/\\/g, "/");
  const raw = readFileSync(cssPath, "utf8");
  return raw.replace(/url\(fonts\//g, `url("file://${fontsDir}/`).replace(
    /\) format\(/g,
    `") format(`,
  );
}
