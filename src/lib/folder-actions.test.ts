import { describe, expect, it } from "vitest";
import type { NavFilter } from "../types/ui";
import {
  buildMovedFolderPath,
  collectFolderPathsFlat,
  folderParentPath,
  isIllegalMoveParent,
  rewriteFolderNavFilterAfterMove,
} from "./folder-actions";

describe("folder-actions move helpers", () => {
  it("buildMovedFolderPath keeps leaf under new parent", () => {
    expect(buildMovedFolderPath("A/B", "C")).toBe("C/B");
    expect(buildMovedFolderPath("A/B", "")).toBe("B");
    expect(buildMovedFolderPath("Articles", "Work")).toBe("Work/Articles");
  });

  it("isIllegalMoveParent blocks self, descendant, and current parent", () => {
    expect(isIllegalMoveParent("A/B", "A/B")).toBe(true);
    expect(isIllegalMoveParent("A/B", "A/B/C")).toBe(true);
    expect(isIllegalMoveParent("A/B", "A")).toBe(true);
    expect(isIllegalMoveParent("A/B", "C")).toBe(false);
    expect(isIllegalMoveParent("A/B", "")).toBe(false);
    expect(isIllegalMoveParent("Inbox", "")).toBe(true);
    expect(folderParentPath("A/B")).toBe("A");
  });

  it("rewriteFolderNavFilterAfterMove rewrites folder and descendants", () => {
    const folder: NavFilter = { type: "folder", folderPath: "A/B" };
    expect(rewriteFolderNavFilterAfterMove(folder, "A/B", "C/B")).toEqual({
      type: "folder",
      folderPath: "C/B",
    });
    expect(
      rewriteFolderNavFilterAfterMove(
        { type: "folder", folderPath: "A/B/X" },
        "A/B",
        "C/B",
      ),
    ).toEqual({ type: "folder", folderPath: "C/B/X" });
    expect(
      rewriteFolderNavFilterAfterMove({ type: "all" }, "A/B", "C/B"),
    ).toBeNull();
  });

  it("collectFolderPathsFlat walks tree", () => {
    expect(
      collectFolderPathsFlat([
        {
          name: "Work",
          path: "Work",
          item_count: 0,
          children: [
            {
              name: "Articles",
              path: "Work/Articles",
              item_count: 1,
              children: [],
            },
          ],
        },
      ]),
    ).toEqual(["Work", "Work/Articles"]);
  });
});
