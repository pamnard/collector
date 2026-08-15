import { describe, expect, it } from "vitest";
import { itemLinksPanelTabs } from "./item-links-panel-tabs";

describe("itemLinksPanelTabs (#410)", () => {
  it("hides the panel when both sides are empty", () => {
    expect(
      itemLinksPanelTabs({ hasRelated: false, backlinkCount: 0 }),
    ).toBeNull();
  });

  it("shows only related when there are no backlinks", () => {
    expect(
      itemLinksPanelTabs({ hasRelated: true, backlinkCount: 0 }),
    ).toEqual({
      showRelated: true,
      showBacklinks: false,
      defaultTab: "related",
    });
  });

  it("shows only backlinks when related is empty", () => {
    expect(
      itemLinksPanelTabs({ hasRelated: false, backlinkCount: 2 }),
    ).toEqual({
      showRelated: false,
      showBacklinks: true,
      defaultTab: "backlinks",
    });
  });

  it("defaults to related when both are present", () => {
    expect(
      itemLinksPanelTabs({ hasRelated: true, backlinkCount: 3 }),
    ).toEqual({
      showRelated: true,
      showBacklinks: true,
      defaultTab: "related",
    });
  });
});
