import { describe, expect, it } from "vitest";
import { measureCoverImageForm } from "./cover-image-form";

describe("measureCoverImageForm", () => {
  it("classifies portrait when height/width >= 1.2", () => {
    expect(measureCoverImageForm(100, 120)).toBe("portrait");
    expect(measureCoverImageForm(100, 200)).toBe("portrait");
  });

  it("classifies landscape when width/height >= 1.2", () => {
    expect(measureCoverImageForm(120, 100)).toBe("landscape");
    expect(measureCoverImageForm(1920, 1080)).toBe("landscape");
  });

  it("classifies square when neither side dominates", () => {
    expect(measureCoverImageForm(100, 100)).toBe("square");
    expect(measureCoverImageForm(100, 119)).toBe("square");
    expect(measureCoverImageForm(119, 100)).toBe("square");
  });

  it("rejects non-positive dimensions", () => {
    expect(() => measureCoverImageForm(0, 100)).toThrow(/positive/i);
    expect(() => measureCoverImageForm(100, 0)).toThrow(/positive/i);
    expect(() => measureCoverImageForm(-1, 10)).toThrow(/positive/i);
  });
});
