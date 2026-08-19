import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMermaidEditorialInitializeConfig,
  MERMAID_EDITORIAL_DARK,
  MERMAID_EDITORIAL_LIGHT,
} from "./mermaid-editorial-theme.ts";
import {
  edgeLabelNodeRepulsion,
  mermaidDisplayError,
  mermaidRenderDomId,
  normalizeMermaidSvgForDisplay,
} from "./mermaid-diagram.ts";

describe("mermaidDisplayError", () => {
  it("uses shared errorMessage, trims, and rejects blank", () => {
    assert.equal(mermaidDisplayError(new Error("parse failed")), "parse failed");
    assert.equal(mermaidDisplayError("raw"), "raw");
    assert.equal(mermaidDisplayError(new Error("  ")), "Unknown Mermaid error");
    assert.equal(mermaidDisplayError(null), "null");
  });
});

describe("mermaidRenderDomId", () => {
  it("sanitizes React useId into a CSS-safe mermaid id", () => {
    assert.equal(mermaidRenderDomId(":r1:"), "mermaid-r1");
    assert.equal(mermaidRenderDomId("r2"), "mermaid-r2");
  });
});

describe("buildMermaidEditorialInitializeConfig", () => {
  it("uses base theme with editorial palette, ELK renderer, and rounded edges", () => {
    const light = buildMermaidEditorialInitializeConfig("light");
    assert.equal(light.theme, "base");
    assert.equal(light.arrowMarkerAbsolute, true);
    assert.equal(light.useMaxWidth, false);
    assert.equal(light.flowchart.useMaxWidth, false);
    assert.equal(light.themeVariables.background, MERMAID_EDITORIAL_LIGHT.paper);
    assert.equal(light.themeVariables.primaryTextColor, MERMAID_EDITORIAL_LIGHT.ink);
    assert.equal(light.themeVariables.fontSize, "12px");
    assert.equal(light.flowchart.curve, "rounded");
    assert.equal(light.flowchart.defaultRenderer, "elk");
    assert.match(light.themeCSS, /stroke-width: 1px/);

    const dark = buildMermaidEditorialInitializeConfig("dark");
    assert.equal(dark.themeVariables.darkMode, true);
    assert.equal(dark.themeVariables.background, MERMAID_EDITORIAL_DARK.paper);
  });
});

describe("normalizeMermaidSvgForDisplay", () => {
  it("replaces responsive width with explicit viewBox pixel dimensions", () => {
    const input =
      '<svg id="x" width="100%" style="max-width: 640px;" viewBox="0 0 640 320"><g /></svg>';
    const output = normalizeMermaidSvgForDisplay(input, "light");
    assert.match(output, /width="640"/);
    assert.match(output, /height="320"/);
    assert.match(output, /style="width:640px;height:320px;max-width:none"/);
    assert.doesNotMatch(output, /width="100%"/);
    assert.doesNotMatch(output, /max-width: 640px/);
    assert.match(output, /font-size: 12px !important/);
    assert.match(output, /padding: 4px 8px !important/);
    assert.match(output, /max-width: none !important/);
    assert.match(output, /color: #2d3142 !important/);
  });

  it("returns svg unchanged when viewBox is missing", () => {
    const input = '<svg width="100%"><g /></svg>';
    assert.equal(normalizeMermaidSvgForDisplay(input, "light"), input);
  });
});

describe("edgeLabelNodeRepulsion", () => {
  it("pushes a label down when it sits flush under a node", () => {
    const node = { left: 0, top: 0, right: 100, bottom: 50 };
    const label = { left: 10, top: 50, right: 90, bottom: 70 };
    assert.deepEqual(edgeLabelNodeRepulsion(label, node, 8), { dx: 0, dy: 8 });
  });

  it("does nothing when vertical gap is already wide enough", () => {
    const node = { left: 0, top: 0, right: 100, bottom: 50 };
    const label = { left: 10, top: 60, right: 90, bottom: 80 };
    assert.deepEqual(edgeLabelNodeRepulsion(label, node, 8), { dx: 0, dy: 0 });
  });

  it("pushes a label right when it sits flush beside a node", () => {
    const node = { left: 0, top: 0, right: 100, bottom: 50 };
    const label = { left: 100, top: 10, right: 180, bottom: 30 };
    assert.deepEqual(edgeLabelNodeRepulsion(label, node, 8), { dx: 8, dy: 0 });
  });

  it("pushes a label away when it overlaps a node corner", () => {
    const node = { left: 0, top: 0, right: 200, bottom: 80 };
    const label = { left: 20, top: 60, right: 180, bottom: 90 };
    const nudge = edgeLabelNodeRepulsion(label, node, 8);
    assert.notEqual(nudge.dx, 0);
    assert.notEqual(nudge.dy, 0);
  });

  it("does nothing when boxes do not overlap", () => {
    const node = { left: 0, top: 0, right: 100, bottom: 50 };
    const label = { left: 120, top: 60, right: 200, bottom: 80 };
    assert.deepEqual(edgeLabelNodeRepulsion(label, node, 8), { dx: 0, dy: 0 });
  });
});
