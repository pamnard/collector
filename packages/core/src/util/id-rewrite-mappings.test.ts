import { describe, expect, it } from "vitest";
import { mappingsHaveOverlappingIds } from "./id-rewrite-mappings.js";

describe("mappingsHaveOverlappingIds", () => {
  it("is false for disjoint old/new sets", () => {
    expect(
      mappingsHaveOverlappingIds([
        { oldId: "Old/a.md", newId: "New/a.md" },
        { oldId: "Old/b.md", newId: "New/b.md" },
      ]),
    ).toBe(false);
  });

  it("detects swap A↔B", () => {
    expect(
      mappingsHaveOverlappingIds([
        { oldId: "A", newId: "B" },
        { oldId: "B", newId: "A" },
      ]),
    ).toBe(true);
  });

  it("detects chain A→B, B→C", () => {
    expect(
      mappingsHaveOverlappingIds([
        { oldId: "A", newId: "B" },
        { oldId: "B", newId: "C" },
      ]),
    ).toBe(true);
  });

  it("detects duplicate newId", () => {
    expect(
      mappingsHaveOverlappingIds([
        { oldId: "A", newId: "C" },
        { oldId: "B", newId: "C" },
      ]),
    ).toBe(true);
  });

  it("detects duplicate oldId", () => {
    expect(
      mappingsHaveOverlappingIds([
        { oldId: "A", newId: "B" },
        { oldId: "A", newId: "C" },
      ]),
    ).toBe(true);
  });
});
