import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { describe, expect, it } from "vitest";
import { MarkdownSpan } from "./MarkdownKatexDisplay";
import {
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS,
} from "./markdown-plugins";
import { normalizeStandaloneDoubleDollarMath } from "./normalize-display-math";

function renderMarkdown(source: string): string {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: MARKDOWN_REMARK_PLUGINS,
        rehypePlugins: MARKDOWN_REHYPE_PLUGINS,
        components: { span: MarkdownSpan },
      },
      normalizeStandaloneDoubleDollarMath(source),
    ),
  );
}

describe("Markdown math (#463)", () => {
  it("renders inline $…$ as KaTeX", () => {
    const html = renderMarkdown("Sum is $a+b$ here.");
    expect(html).toContain("katex");
    expect(html).not.toContain("$a+b$");
  });

  it("renders block $$…$$ as display KaTeX", () => {
    const html = renderMarkdown("$$\n\\frac{1}{2}\n$$");
    expect(html).toContain("katex");
    expect(html).toMatch(/katex-display|display/);
  });

  it("treats whole-line $$...$$ as display math (Obsidian-style)", () => {
    const html = renderMarkdown(
      "$$\\text{Payout} = \\left( \\frac{a}{b} \\right)$$",
    );
    expect(html).toContain("katex-display");
    expect(html).not.toContain("mtight");
    expect(html).toContain("justify-center");
  });

  it("wraps block math for centered layout", () => {
    const html = renderMarkdown("$$\n\\frac{1}{2}\n$$");
    expect(html).toContain("katex-display");
    expect(html).toContain("justify-center");
  });

  it("shows a visible error for broken math (no blank silent fail)", () => {
    const html = renderMarkdown("$$\\begin{zzz}$$");
    expect(html.length).toBeGreaterThan(0);
    expect(html).toMatch(/katex-error|ParseError|Undefined|error/i);
  });
});
