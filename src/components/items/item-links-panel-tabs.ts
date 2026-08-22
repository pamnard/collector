export type ItemLinksTabId = "related" | "outgoing" | "backlinks";

/** Which footer link tabs to show (#410 / #457). */
export function itemLinksPanelTabs(options: {
  hasRelated: boolean;
  outgoingCount: number;
  backlinkCount: number;
}): {
  showRelated: boolean;
  showOutgoing: boolean;
  showBacklinks: boolean;
  defaultTab: ItemLinksTabId;
} | null {
  const showRelated = options.hasRelated;
  const showOutgoing = options.outgoingCount > 0;
  const showBacklinks = options.backlinkCount > 0;
  if (!showRelated && !showOutgoing && !showBacklinks) {
    return null;
  }
  const defaultTab: ItemLinksTabId = showRelated
    ? "related"
    : showOutgoing
      ? "outgoing"
      : "backlinks";
  return {
    showRelated,
    showOutgoing,
    showBacklinks,
    defaultTab,
  };
}

/** Prefer the user's last choice when that tab exists on this item. */
export function resolveItemLinksTab(
  preferred: ItemLinksTabId,
  tabs: {
    showRelated: boolean;
    showOutgoing: boolean;
    showBacklinks: boolean;
    defaultTab: ItemLinksTabId;
  },
): ItemLinksTabId {
  if (preferred === "related" && tabs.showRelated) {
    return "related";
  }
  if (preferred === "outgoing" && tabs.showOutgoing) {
    return "outgoing";
  }
  if (preferred === "backlinks" && tabs.showBacklinks) {
    return "backlinks";
  }
  return tabs.defaultTab;
}
