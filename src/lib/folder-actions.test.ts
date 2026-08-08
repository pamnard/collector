import { describe, expect, it } from "vitest";
import type { NavFilter } from "../types/ui";
import {
  buildChildFolderPath,
  buildMovedFolderPath,
  buildRenamedFolderPath,
  clearFolderNavFilterAfterDelete,
  collectFolderPathsFlat,
  folderLeafName,
  folderParentPath,
  isCurrentItemFolderDestination,
  isIllegalMoveParent,
  listFolderParentChoices,
  listItemFolderDestinations,
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

  it("clearFolderNavFilterAfterDelete resets deleted path and descendants", () => {
    expect(
      clearFolderNavFilterAfterDelete(
        { type: "folder", folderPath: "A/B" },
        "A/B",
      ),
    ).toBe("all");
    expect(
      clearFolderNavFilterAfterDelete(
        { type: "folder", folderPath: "A/B/X" },
        "A/B",
      ),
    ).toBe("all");
    expect(
      clearFolderNavFilterAfterDelete(
        { type: "folder", folderPath: "Other" },
        "A/B",
      ),
    ).toBeNull();
    expect(clearFolderNavFilterAfterDelete("all", "A/B")).toBeNull();
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

  it("listFolderParentChoices puts vault root first", () => {
    expect(
      listFolderParentChoices([
        {
          name: "Work",
          path: "Work",
          item_count: 0,
          children: [],
        },
      ]),
    ).toEqual([
      { parentPath: "", label: "/" },
      { parentPath: "Work", label: "Work" },
    ]);
  });

  it("listItemFolderDestinations ensures Inbox and omits vault root", () => {
    expect(
      listItemFolderDestinations([
        {
          name: "Work",
          path: "Work",
          item_count: 0,
          children: [],
        },
      ]),
    ).toEqual([
      { path: "Inbox", label: "Inbox" },
      { path: "Work", label: "Work" },
    ]);
  });

  it("isCurrentItemFolderDestination treats empty and Inbox as current", () => {
    expect(isCurrentItemFolderDestination("", "Inbox")).toBe(true);
    expect(isCurrentItemFolderDestination("Inbox", "inbox")).toBe(true);
    expect(isCurrentItemFolderDestination("Work", "Work")).toBe(true);
    expect(isCurrentItemFolderDestination("Work", "Inbox")).toBe(false);
  });
});

describe("folder-actions rename helpers", () => {
  it("folderLeafName returns last segment", () => {
    expect(folderLeafName("Articles")).toBe("Articles");
    expect(folderLeafName("A/B")).toBe("B");
    expect(folderLeafName("Work/Articles/Drafts")).toBe("Drafts");
  });

  it("buildRenamedFolderPath keeps parent and replaces leaf", () => {
    expect(buildRenamedFolderPath("A/B", "C")).toBe("A/C");
    expect(buildRenamedFolderPath("Articles", "Notes")).toBe("Notes");
    expect(buildRenamedFolderPath("Work/Articles", "  Drafts  ")).toBe(
      "Work/Drafts",
    );
  });

  it("buildRenamedFolderPath rejects empty and slash-containing leaf", () => {
    expect(() => buildRenamedFolderPath("A/B", "")).toThrow(
      /leaf name must be non-empty/i,
    );
    expect(() => buildRenamedFolderPath("A/B", "   ")).toThrow(
      /leaf name must be non-empty/i,
    );
    expect(() => buildRenamedFolderPath("A/B", "C/D")).toThrow(
      /leaf name must not contain/i,
    );
  });

  it("buildChildFolderPath joins parent and leaf", () => {
    expect(buildChildFolderPath("Parent", "Child")).toBe("Parent/Child");
    expect(buildChildFolderPath("Work/Articles", "  Drafts  ")).toBe(
      "Work/Articles/Drafts",
    );
  });

  it("buildChildFolderPath rejects empty parent, empty leaf, and slash in leaf", () => {
    expect(() => buildChildFolderPath("", "Child")).toThrow(
      /parent folder path must be non-empty/i,
    );
    expect(() => buildChildFolderPath("   ", "Child")).toThrow(
      /parent folder path must be non-empty/i,
    );
    expect(() => buildChildFolderPath("Parent", "")).toThrow(
      /leaf name must be non-empty/i,
    );
    expect(() => buildChildFolderPath("Parent", "   ")).toThrow(
      /leaf name must be non-empty/i,
    );
    expect(() => buildChildFolderPath("Parent", "A/B")).toThrow(
      /leaf name must not contain/i,
    );
  });
});
