import { describe, expect, it } from "vitest";
import {
  markdownSegmentToHtml,
  renderResolvedPrintHtml,
  resolvePrintDocument,
} from "./build-item-print-html.js";
import { buildItemPrintModel } from "./item-print-model.js";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("build-item-print-html (#304)", () => {
  it("emits light theme hero + title + inline media rules", () => {
    const model = buildItemPrintModel({
      title: "Fixture Note",
      body: [
        "Hello body",
        "",
        "![inline](media/u/inline.png)",
        "",
        "![clip](media/u/clip.mp4)",
        "",
        "![song](media/u/song.mp3)",
        "",
        "![paper](media/u/paper.pdf)",
      ].join("\n"),
      heroSrc: "/vault/cover.webp",
    });

    const resolved = resolvePrintDocument(model, {
      fontCss: '@font-face { font-family: "Golos Text"; src: local("Golos Text"); }',
      heroDataUri: TINY_PNG,
      imageDataUri: (src) =>
        src.endsWith("inline.png") ? TINY_PNG : null,
      videoStillDataUri: (src) =>
        src.endsWith("clip.mp4") ? TINY_PNG : null,
    });

    const html = renderResolvedPrintHtml(resolved);
    expect(html).toContain('data-print-theme="light"');
    expect(html).toContain("background: #ffffff");
    expect(html).toContain("Golos Text");
    expect(html).toContain('class="print-hero"');
    expect(html).toContain('class="print-title">Fixture Note</h1>');
    expect(html).toContain("Hello body");
    expect(html).toContain('class="print-inline-media"');
    expect(html).toContain("print-video-still");
    expect(html).toContain("audio: song.mp3");
    expect(html).toContain("pdf: paper.pdf");
    expect(html).not.toContain("gallery-only");
    expect(html).not.toContain("aside");
  });

  it("fails when inline image is not ready", () => {
    const model = buildItemPrintModel({
      title: "X",
      body: "![x](media/u/missing.png)",
      heroSrc: null,
    });
    expect(() =>
      resolvePrintDocument(model, {
        fontCss: "",
        heroDataUri: null,
        imageDataUri: () => null,
        videoStillDataUri: () => null,
      }),
    ).toThrow(/print image not ready/);
  });

  it("renders mermaid fences as mermaid pre blocks", () => {
    const html = markdownSegmentToHtml("```mermaid\ngraph TD\nA-->B\n```");
    expect(html).toContain('<pre class="mermaid">');
    expect(html).toContain("graph TD");
  });
});
