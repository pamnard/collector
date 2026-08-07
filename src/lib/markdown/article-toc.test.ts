import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toHast } from "mdast-util-to-hast";
import { gfm } from "micromark-extension-gfm";
import rehypeSlug from "rehype-slug";
import { visit } from "unist-util-visit";
import {
  ARTICLE_TOC_MIN_ITEMS,
  articleTocForView,
  extractArticleToc,
} from "./article-toc.ts";

describe("extractArticleToc", () => {
  it("collects only h2 and h3 with stable slugs", () => {
    const items = extractArticleToc(`# Title

## One

text

### Nested

## Two
`);
    assert.deepEqual(items, [
      { id: "one", text: "One", level: 2 },
      { id: "nested", text: "Nested", level: 3 },
      { id: "two", text: "Two", level: 2 },
    ]);
  });

  it("keeps slug counter in sync with skipped h1/h4 so rehype-slug ids match", () => {
    const items = extractArticleToc(`# Intro

## Intro

#### Deep

## Other
`);
    assert.deepEqual(items, [
      { id: "intro-1", text: "Intro", level: 2 },
      { id: "other", text: "Other", level: 2 },
    ]);
  });

  it("suffixes duplicate h2/h3 slugs", () => {
    const items = extractArticleToc(`## Same

## Same
`);
    assert.deepEqual(items, [
      { id: "same", text: "Same", level: 2 },
      { id: "same-1", text: "Same", level: 2 },
    ]);
  });

  it("slugifies unicode heading text", () => {
    const items = extractArticleToc(`## Привет мир

## Второй
`);
    assert.equal(items[0]?.id, "привет-мир");
    assert.equal(items[0]?.text, "Привет мир");
    assert.equal(items[1]?.id, "второй");
  });

  it("returns empty for blank markdown", () => {
    assert.deepEqual(extractArticleToc(""), []);
    assert.deepEqual(extractArticleToc("   \n"), []);
  });

  it("ignores headings inside fenced code blocks", () => {
    const items = extractArticleToc(`## Real

\`\`\`
## Not a heading
\`\`\`

## Also real
`);
    assert.deepEqual(items, [
      { id: "real", text: "Real", level: 2 },
      { id: "also-real", text: "Also real", level: 2 },
    ]);
  });

  it("ids match rehype-slug when h1 consumes a slug before h2", () => {
    const md = `# Intro

## Intro

### Nested

## Other
`;
    const items = extractArticleToc(md);
    const mdast = fromMarkdown(md, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    });
    const hast = toHast(mdast);
    rehypeSlug()(hast);
    const ids = new Set<string>();
    visit(hast, "element", (node) => {
      if (
        node.type === "element" &&
        /^h[1-6]$/.test(node.tagName) &&
        typeof node.properties?.id === "string"
      ) {
        ids.add(node.properties.id);
      }
    });
    for (const item of items) {
      assert.ok(ids.has(item.id), `missing rehype id for ${item.id}`);
    }
  });
});

describe("articleTocForView", () => {
  it(`returns toc only in view mode with at least ${ARTICLE_TOC_MIN_ITEMS} items`, () => {
    const body = `## A\n\n## B\n\n## C\n`;
    assert.equal(articleTocForView("form", body).length, 0);
    assert.equal(articleTocForView("view", null).length, 0);
    assert.equal(articleTocForView("view", `## A\n\n## B\n`).length, 0);
    assert.equal(articleTocForView("view", body).length, 3);
  });
});
