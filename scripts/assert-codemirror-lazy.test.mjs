/**
 * Guard: CodeMirror loads only with the item source editor (#803).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSrc(rel) {
  return readFileSync(join(root, "src", rel), "utf8");
}

describe("CodeMirror lazy-load (#803)", () => {
  it("ItemDetailPage does not statically import ItemDetailSourceEditor", () => {
    const page = readSrc("pages/ItemDetailPage.tsx");
    assert.equal(
      /import\s*\{[^}]*ItemDetailSourceEditor[^}]*\}\s*from\s*["'][^"']*ItemDetailSourceEditor["']/.test(
        page,
      ),
      false,
      "ItemDetailPage must not statically import ItemDetailSourceEditor",
    );
    assert.match(
      page,
      /lazy\s*\(\s*\(\s*\)\s*=>\s*import\(\s*["'][^"']*ItemDetailSourceEditor["']/,
      "ItemDetailPage must lazy(() => import(...ItemDetailSourceEditor))",
    );
  });

  it("syntax-highlight-colors does not import @codemirror (preview/dashboard safe)", () => {
    const colors = readSrc("lib/syntax-highlight-colors.ts");
    assert.equal(
      /@codemirror\//.test(colors),
      false,
      "syntax-highlight-colors must not import @codemirror/*",
    );
    assert.match(colors, /export const darkSyntaxColors/);
    assert.match(colors, /export const lightSyntaxColors/);
  });
});
