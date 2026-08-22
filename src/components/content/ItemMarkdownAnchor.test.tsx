import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ItemMarkdownAnchor } from "./ItemMarkdownAnchor";

vi.mock("../ui/tooltip", async (importOriginal) => {
  const React = await import("react");
  const actual = await importOriginal<typeof import("../ui/tooltip")>();
  return {
    ...actual,
    // Portal content is not mounted in SSR; stub Content so we can assert side + text.
    TooltipContent: ({
      side,
      children,
    }: {
      side?: string;
      children?: ReactNode;
    }) =>
      React.createElement(
        "span",
        { "data-slot": "tooltip-content", "data-side": side ?? "top" },
        children,
      ),
  };
});

function renderAnchor(
  props: {
    href?: string;
    children?: ReactNode;
  } = {},
): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(
        ItemMarkdownAnchor,
        { href: props.href },
        props.children ?? "label",
      ),
    ),
  );
}

describe("ItemMarkdownAnchor external tooltip", () => {
  it("shows full href in a bottom tooltip on external links", () => {
    const href = "https://example.com/path?q=1";
    const html = renderAnchor({ href });

    expect(html).toContain(`href="${href}"`);
    expect(html).toContain('data-slot="tooltip-trigger"');
    expect(html).toContain('data-slot="tooltip-content"');
    expect(html).toContain('data-side="bottom"');
    expect(html).toContain(href);
    expect(html).not.toMatch(/<button\b/);
  });

  it("does not wrap internal item links in a tooltip", () => {
    const html = renderAnchor({ href: "/item/Inbox/a.md" });

    expect(html).toContain('href="/item/Inbox/a.md"');
    expect(html).not.toContain('data-slot="tooltip-trigger"');
    expect(html).not.toContain('data-slot="tooltip-content"');
  });

  it("skips tooltip when external href is empty", () => {
    const html = renderAnchor({ href: "" });

    expect(html).not.toContain('data-slot="tooltip-trigger"');
    expect(html).not.toContain('data-slot="tooltip-content"');
  });
});
