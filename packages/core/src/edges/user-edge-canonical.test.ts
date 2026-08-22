import { describe, expect, it } from "vitest";
import { canonicalUserEdgePair } from "./user-edge-canonical.js";

describe("canonicalUserEdgePair (#407)", () => {
  it("orders endpoints lexicographically", () => {
    expect(canonicalUserEdgePair("b.md", "a.md")).toEqual({
      fromId: "a.md",
      toId: "b.md",
    });
  });

  it("rejects self edges", () => {
    expect(() => canonicalUserEdgePair("same.md", "same.md")).toThrow(
      "user edge endpoints must differ",
    );
  });
});
