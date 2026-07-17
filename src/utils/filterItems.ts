import type { ItemFile } from "@collector/shared";
import type { NavFilter } from "../types/ui";
import { isFolderFilter, isTagFilter } from "../types/ui";

export function filterItems(
  items: ItemFile[],
  activeFilter: NavFilter,
): ItemFile[] {
  return items.filter((item) => {
    if (isTagFilter(activeFilter)) {
      return item.tag_ids.includes(activeFilter.tagId);
    }
    if (isFolderFilter(activeFilter)) {
      const path = activeFilter.folderPath;
      return item.folder_path === path || item.folder_path.startsWith(`${path}/`);
    }
    return true;
  });
}
