import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mermaidDisplayError,
  mermaidRenderDomId,
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
