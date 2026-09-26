import { describe, expect, it } from "vitest";
import {
  cosineToUnitInterval,
  folderPathNameTokens,
  hybridFolderMoveScore,
  itemSignalNameTokens,
  tokenizeForFolderNameOverlap,
  tokenSetOverlap,
  FOLDER_MOVE_CENTROID_WEIGHT,
  FOLDER_MOVE_NAME_WEIGHT,
} from "./folder-move-score.js";

describe("folder-move-score", () => {
  it("tokenizes unicode letters and digits", () => {
    expect([...tokenizeForFolderNameOverlap("Hello, мир-42!")].sort()).toEqual([
      "42",
      "hello",
      "мир",
    ]);
  });

  it("computes Jaccard overlap", () => {
    expect(tokenSetOverlap(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(
      1 / 3,
    );
    expect(tokenSetOverlap(new Set(), new Set(["a"]))).toBe(0);
  });

  it("builds name tokens from item signal and folder path", () => {
    const item = itemSignalNameTokens({
      title: "Design systems",
      description: "tokens",
      tagNames: ["UI"],
    });
    expect(item.has("design")).toBe(true);
    expect(item.has("ui")).toBe(true);
    expect(folderPathNameTokens("Work/Design").has("design")).toBe(true);
  });

  it("maps cosine to unit interval and hybrid weights", () => {
    expect(cosineToUnitInterval(1)).toBe(1);
    expect(cosineToUnitInterval(-1)).toBe(0);
    expect(cosineToUnitInterval(0)).toBe(0.5);
    expect(
      hybridFolderMoveScore({ centroidUnit: 1, nameOverlap: 0 }),
    ).toBeCloseTo(FOLDER_MOVE_CENTROID_WEIGHT);
    expect(
      hybridFolderMoveScore({ centroidUnit: null, nameOverlap: 1 }),
    ).toBe(1);
    expect(
      hybridFolderMoveScore({ centroidUnit: 0, nameOverlap: 1 }),
    ).toBeCloseTo(FOLDER_MOVE_NAME_WEIGHT);
  });
});
