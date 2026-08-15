/** Which footer link tabs to show (#410). */
export function itemLinksPanelTabs(options: {
  hasRelated: boolean;
  backlinkCount: number;
}): { showRelated: boolean; showBacklinks: boolean; defaultTab: "related" | "backlinks" } | null {
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
