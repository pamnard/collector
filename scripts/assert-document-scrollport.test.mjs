/**
 * Guard: document/html must not scroll. MainScrollArea is the only page
 * scrollport (#117). Mermaid injects body>.mermaidTooltip with inline
 * position:absolute; idle box (~6px) grows document scrollHeight and shows a
 * second window scrollbar next to .main-scrollbar.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("document scrollport guard", () => {
  it("locks html/body overflow so the window never gains a scrollbar", () => {
    const css = readFileSync(join(root, "src/index.css"), "utf8");
    assert.match(
      css,
      /html,\s*\n?\s*body\s*\{[^}]*overflow:\s*hidden/s,
      "html, body must set overflow: hidden (single scrollport = MainScrollArea)",
    );
  });

  it("pins .mermaidTooltip to fixed so idle absolute box cannot grow document", () => {
    const css = readFileSync(
      join(root, "src/styles/markdown-code-highlight.css"),
      "utf8",
    );
    assert.match(
      css,
      /\.mermaidTooltip\s*\{[^}]*position:\s*fixed\s*!important/s,
      "mermaidTooltip needs position:fixed !important (Mermaid sets inline absolute)",
    );
  });
});
