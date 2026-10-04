import { describe, expect, it } from "vitest";
import { renderResolvedPrintHtml } from "./build-item-print-html.js";

describe("print overflow wrap (#304)", () => {
  it("uses wrap rules instead of clip/scale hooks for wide text blocks", () => {
    const html = renderResolvedPrintHtml({
      title: "Wide",
      heroDataUri: null,
      bodyParts: [{ kind: "markdown", text: "body" }],
      fontCss: "",
      katexCss: "",
    });
    expect(html).toMatch(
      /\.print-body \.katex-display\s*\{[^}]*overflow:\s*visible/,
    );
    expect(html).not.toMatch(
      /\.print-body \.katex-display\s*\{[^}]*overflow:\s*hidden/,
    );
    expect(html).toMatch(/white-space:\s*pre-wrap/);
    expect(html).toMatch(/overflow-wrap:\s*anywhere/);
    expect(html).toMatch(
      /\.print-body \.katex-display \.katex-html \*\s*\{[^}]*white-space:\s*normal\s*!important/,
    );
    expect(html).not.toContain("data-print-fit");
    expect(html).not.toContain("transform:");
  });
});
