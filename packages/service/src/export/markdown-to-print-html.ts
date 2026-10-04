/**
 * Host print markdown → HTML using the same remark/rehype stack as
 * `MarkdownContent` / `markdown-plugins.ts` (#304).
 */

import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";

/**
 * Obsidian-compatible display math: a whole line `$$...$$` is block math.
 * Same rewrite as UI `normalizeStandaloneDoubleDollarMath`.
 */
export function normalizeStandaloneDoubleDollarMath(markdown: string): string {
  return markdown.replace(
    /^[ \t]*\$\$([^\n]+?)\$\$[ \t]*$/gm,
    (_match, body: string) => `$$\n${body.trim()}\n$$`,
  );
}

function classList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === "string") {
    return value.split(/\s+/).filter(Boolean);
  }
  return [];
}

type HastElement = {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown>;
  children: Array<{ type: string; value?: string; tagName?: string }>;
};

/** Turn `language-mermaid` code fences into `<pre class="mermaid">` for mermaid.run. */
function rehypeMermaidPrintFences() {
  return (tree: unknown): void => {
    visit(tree as never, "element", (node: HastElement) => {
      if (node.tagName !== "pre") {
        return;
      }
      const code = node.children.find(
        (child): child is HastElement =>
          child.type === "element" && child.tagName === "code",
      );
      if (!code) {
        return;
      }
      const classes = classList(code.properties?.className);
      if (!classes.includes("language-mermaid")) {
        return;
      }
      const text = code.children
        .map((child) => (child.type === "text" ? (child.value ?? "") : ""))
        .join("");
      node.properties = {
        ...node.properties,
        className: ["mermaid"],
      };
      node.children = [{ type: "text", value: text }];
    });
  };
}

const printMarkdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRehype)
  .use(rehypeKatex, {
    // Match UI markdown-plugins.ts (throwOnError is applied by rehype-katex default).
    strict: "ignore",
    minRuleThickness: 0.08,
  } as Parameters<typeof rehypeKatex>[0])
  .use(rehypeSlug)
  .use(rehypeHighlight, { detect: false, ignoreMissing: true })
  .use(rehypeMermaidPrintFences)
  .use(rehypeStringify);

/**
 * Render a markdown body segment with the reading-view plugin pipeline.
 * Synchronous: print jobs must fail fast on processor errors.
 */
export function markdownSegmentToHtml(text: string): string {
  if (!text.trim()) {
    return "";
  }
  const normalized = normalizeStandaloneDoubleDollarMath(text);
  const file = printMarkdownProcessor.processSync(normalized);
  return String(file);
}
