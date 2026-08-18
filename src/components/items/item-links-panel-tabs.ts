export type ItemLinksTabId = "related" | "backlinks";

/** Which footer link tabs to show (#410). */
export function itemLinksPanelTabs(options: {
  hasRelated: boolean;
  backlinkCount: number;
}): {
  showRelated: boolean;
  showBacklinks: boolean;
  defaultTab: ItemLinksTabId;
} | null {
  const showRelated = options.hasRelated;
  const showBacklinks = options.backlinkCount > 0;
  if (!showRelated && !showBacklinks) {
    return null;
  }
  return {
    showRelated,
    showBacklinks,
    defaultTab: showRelated ? "related" : "backlinks",
  };
}

/** Prefer the user's last choice when that tab exists on this item. */
export function resolveItemLinksTab(
  preferred: ItemLinksTabId,
  tabs: {
    showRelated: boolean;
    showBacklinks: boolean;
    defaultTab: ItemLinksTabId;
  },
): ItemLinksTabId {
  if (preferred === "related" && tabs.showRelated) {
    return "related";
  }
  if (preferred === "backlinks" && tabs.showBacklinks) {
    return "backlinks";
  }
  return tabs.defaultTab;
}
