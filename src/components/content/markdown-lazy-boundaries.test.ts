import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("markdown stack lazy boundaries (#802)", () => {
  it("ItemDetailViewBody lazy-imports MarkdownContent", () => {
    const src = readSrc("src/components/items/ItemDetailViewBody.tsx");
    assert.equal(
      /import\s*\{\s*MarkdownContent\s*\}\s*from\s*["'].*MarkdownContent["']/.test(
        src,
      ),
      false,
    );
    assert.match(src, /lazy\(/);
    assert.match(src, /import\(["']\.\.\/content\/MarkdownContent["']\)/);
  });

  it("MarkdownCodeBlock lazy-imports MermaidDiagram", () => {
    const src = readSrc("src/components/content/MarkdownCodeBlock.tsx");
    assert.equal(
      /import\s*\{\s*MermaidDiagram\s*\}\s*from\s*["'].*MermaidDiagram["']/.test(
        src,
      ),
      false,
    );
    assert.match(src, /lazy\(/);
    assert.match(src, /import\(["']\.\/MermaidDiagram["']\)/);
  });

  it("McpSettingsSection lazy-imports MarkdownPre / MarkdownCodeBlock", () => {
    const src = readSrc("src/pages/McpSettingsSection.tsx");
    assert.equal(
      /import\s*\{\s*MarkdownPre\s*\}\s*from\s*["'].*MarkdownCodeBlock["']/.test(
        src,
      ),
      false,
    );
    assert.match(src, /lazy\(/);
    assert.match(
      src,
      /import\(["']\.\.\/components\/content\/MarkdownCodeBlock["']\)/,
    );
  });
});
