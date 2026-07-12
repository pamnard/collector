import type { NavFilterSetting } from "@collector/shared";
import {
  isFolderFilter,
  isTagFilter,
  navFilterFromSetting as navFilterFromSettingCore,
  navFilterToSetting as navFilterToSettingCore,
  type NavSearchFilter,
} from "@collector/core";

export type NavFilter = NavSearchFilter;

export { isFolderFilter, isTagFilter };

export function navFilterKey(filter: NavFilter): string {
  if (isTagFilter(filter)) {
    return `tag:${filter.tagId}`;
  }
  if (isFolderFilter(filter)) {
    return `folder:${filter.folderPath}`;
  }
  return filter;
}

export function navFilterFromSetting(setting: NavFilterSetting): NavFilter {
  return navFilterFromSettingCore(setting);
}

export function navFilterToSetting(filter: NavFilter): NavFilterSetting {
  return navFilterToSettingCore(filter);
}

export type ViewMode = "grid" | "table";
