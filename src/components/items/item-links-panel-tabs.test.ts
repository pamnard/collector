import { describe, expect, it } from "vitest";
import { itemLinksPanelTabs, resolveItemLinksTab } from "./item-links-panel-tabs";

describe("itemLinksPanelTabs (#410 / #457)", () => {
  it("hides the panel when all sides are empty", () => {
    expect(
      itemLinksPanelTabs({
        hasRelated: false,
        outgoingCount: 0,
        backlinkCount: 0,
      }),
    ).toBeNull();
  });

  it("shows only related when there are no other links", () => {
    expect(
      itemLinksPanelTabs({
        hasRelated: true,
        outgoingCount: 0,
        backlinkCount: 0,
      }),
    ).toEqual({
      showRelated: true,
      showOutgoing: false,
      showBacklinks: false,
      defaultTab: "related",
    });
  });

  it("shows only outgoing when related and backlinks are empty", () => {
    expect(
      itemLinksPanelTabs({
        hasRelated: false,
        outgoingCount: 2,
        backlinkCount: 0,
      }),
    ).toEqual({
      showRelated: false,
      showOutgoing: true,
      showBacklinks: false,
      defaultTab: "outgoing",
    });
  });

  it("shows only backlinks when related and outgoing are empty", () => {
    expect(
      itemLinksPanelTabs({
        hasRelated: false,
        outgoingCount: 0,
        backlinkCount: 2,
      }),
    ).toEqual({
      showRelated: false,
      showOutgoing: false,
      showBacklinks: true,
      defaultTab: "backlinks",
    });
  });

  it("defaults to related when multiple tabs exist", () => {
    expect(
      itemLinksPanelTabs({
        hasRelated: true,
        outgoingCount: 1,
        backlinkCount: 3,
      }),
    ).toEqual({
      showRelated: true,
      showOutgoing: true,
      showBacklinks: true,
      defaultTab: "related",
    });
  });
});

describe("resolveItemLinksTab (#410 / #457)", () => {
  const all = {
    showRelated: true,
    showOutgoing: true,
    showBacklinks: true,
    defaultTab: "related" as const,
  };

  it("keeps the preferred tab when it is available", () => {
    expect(resolveItemLinksTab("outgoing", all)).toBe("outgoing");
    expect(resolveItemLinksTab("backlinks", all)).toBe("backlinks");
    expect(resolveItemLinksTab("related", all)).toBe("related");
  });

  it("falls back when the preferred tab is missing", () => {
    expect(
      resolveItemLinksTab("outgoing", {
        showRelated: true,
        showOutgoing: false,
        showBacklinks: true,
        defaultTab: "related",
      }),
    ).toBe("related");
    expect(
      resolveItemLinksTab("related", {
        showRelated: false,
        showOutgoing: true,
        showBacklinks: false,
        defaultTab: "outgoing",
      }),
    ).toBe("outgoing");
  });
});
