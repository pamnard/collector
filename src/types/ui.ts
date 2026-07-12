import type { NavFilterSetting } from "@collector/shared";
import type { NavSearchFilter } from "@collector/core";

export type NavFilter = NavSearchFilter;

export function isTagFilter(
  filter: NavFilter,
): filter is { type: "tag"; tagId: string } {
  return typeof filter === "object" && filter.type === "tag";
}

export function navFilterKey(filter: NavFilter): string {
  if (isTagFilter(filter)) {
    return `tag:${filter.tagId}`;
  }
  return filter;
}

export function navFilterFromSetting(setting: NavFilterSetting): NavFilter {
  if (typeof setting === "string") {
    return setting;
  }
  return { type: "tag", tagId: setting.tag_id };
}

export function navFilterToSetting(filter: NavFilter): NavFilterSetting {
  if (isTagFilter(filter)) {
    return { type: "tag", tag_id: filter.tagId };
  }
  return filter;
}

export type ViewMode = "grid" | "table";
