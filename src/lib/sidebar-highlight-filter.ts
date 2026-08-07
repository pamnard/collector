import type { NavFilter } from "../types/ui";

export type ResolveSidebarHighlightFilterInput = {
  isItemRoute: boolean;
  /** Ready item folder path; `null` when chrome has no ready item. */
  itemFolderPath: string | null;
  navFilter: NavFilter;
};

/**
 * Display-only sidebar highlight. Does not mutate persisted `nav_filter`.
 * On `/item/…` with a ready item, highlight that item's folder (or `"all"` for root).
 */
export function resolveSidebarHighlightFilter(
  input: ResolveSidebarHighlightFilterInput,
): NavFilter {
  if (!input.isItemRoute || input.itemFolderPath === null) {
    return input.navFilter;
  }
  if (input.itemFolderPath === "") {
    return "all";
  }
  return { type: "folder", folderPath: input.itemFolderPath };
}
