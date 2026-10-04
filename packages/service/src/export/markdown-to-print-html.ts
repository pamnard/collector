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
import type { Node } from "unist";
import { visit } from "unist-util-visit";

/**
 * Obsidian-compatible display math: a whole line `$$...$$` is block math.
 * Kept in sync with UI `normalizeStandaloneDoubleDollarMath`.
 */
export function normalizeStandaloneDoubleDollarMath(markdown: string): string {
  return markdown.replace(
    /^[ \t]*\$\$([^\n]+?)\$\$[ \t]*$/gm,
    (_match, body: string) => `$$\n${body.trim()}\n$$`,
  );
}

type HastElement = {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown>;
  children: Array<{ type: string; value?: string; tagName?: string }>;
};

/** Turn `language-mermaid` code fences into `<pre class="mermaid">` for mermaid.run. */
function rehypeMermaidPrintFences() {
  return (tree: Node): void => {
    visit(tree, "element", (node: HastElement) => {
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
      const className = code.properties?.className;
      const classes = Array.isArray(className)
        ? className.map(String)
        : typeof className === "string"
          ? className.split(/\s+/).filter(Boolean)
          : [];
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
    strict: "ignore",
    minRuleThickness: 0.08,
  } as Parameters<typeof rehypeKatex>[0])
  .use(rehypeSlug)
  .use(rehypeHighlight, { detect: false, ignoreMissing: true })
  .use(rehypeMermaidPrintFences)
  .use(rehypeStringify);

/** Render a markdown body segment with the reading-view plugin pipeline. */
export function markdownSegmentToHtml(text: string): string {
  if (!text.trim()) {
    return "";
  }
  const normalized = normalizeStandaloneDoubleDollarMath(text);
  return String(printMarkdownProcessor.processSync(normalized));
}
