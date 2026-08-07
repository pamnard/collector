import { describe, expect, it } from "vitest";
import type { NavFilter } from "../types/ui";
import { resolveSidebarHighlightFilter } from "./sidebar-highlight-filter";

const folderB: NavFilter = { type: "folder", folderPath: "b" };
const folderA: NavFilter = { type: "folder", folderPath: "a" };
const nested: NavFilter = { type: "folder", folderPath: "a/b" };
const tagFilter: NavFilter = { type: "tag", tagId: "tag-1" };

describe("resolveSidebarHighlightFilter", () => {
  it("returns navFilter when not on item route", () => {
    expect(
      resolveSidebarHighlightFilter({
        isItemRoute: false,
        itemFolderPath: "a",
        navFilter: folderB,
      }),
    ).toEqual(folderB);
  });

  it("returns navFilter on item route while chrome has no ready item", () => {
    expect(
      resolveSidebarHighlightFilter({
        isItemRoute: true,
        itemFolderPath: null,
        navFilter: folderB,
      }),
    ).toEqual(folderB);
    expect(
      resolveSidebarHighlightFilter({
        isItemRoute: true,
        itemFolderPath: null,
        navFilter: tagFilter,
      }),
    ).toEqual(tagFilter);
  });

  it("highlights the item folder on item route, ignoring prior folder navFilter", () => {
    expect(
      resolveSidebarHighlightFilter({
        isItemRoute: true,
        itemFolderPath: "a",
        navFilter: folderB,
      }),
    ).toEqual(folderA);
  });

  it("highlights nested item folder for ancestor expansion keys", () => {
    expect(
      resolveSidebarHighlightFilter({
        isItemRoute: true,
        itemFolderPath: "a/b",
        navFilter: folderB,
      }),
    ).toEqual(nested);
  });

  it("uses all when item folder_path is empty (root)", () => {
    expect(
      resolveSidebarHighlightFilter({
        isItemRoute: true,
        itemFolderPath: "",
        navFilter: folderB,
      }),
    ).toBe("all");
  });

  it("overrides a prior tag navFilter with the item folder", () => {
    expect(
      resolveSidebarHighlightFilter({
        isItemRoute: true,
        itemFolderPath: "Inbox",
        navFilter: tagFilter,
      }),
    ).toEqual({ type: "folder", folderPath: "Inbox" });
  });
});
