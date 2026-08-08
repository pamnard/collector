import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownTable } from "./MarkdownTable";

describe("MarkdownTable (#592)", () => {
  it("wraps the table in a horizontal scroll container", () => {
    const html = renderToStaticMarkup(
      createElement(
        MarkdownTable,
        null,
        createElement("tbody", null, createElement("tr", null)),
      ),
    );

    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("custom-scrollbar");
    expect(html).toMatch(/<div[^>]*overflow-x-auto[\s\S]*?<table[\s\S]*?<\/table>\s*<\/div>/);
  });
});
