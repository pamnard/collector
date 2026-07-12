import type { ItemFile } from "@collector/shared";
import type { NavFilter } from "../types/ui";
import { isFolderFilter, isTagFilter } from "../types/ui";

export function filterItems(
  items: ItemFile[],
  activeFilter: NavFilter,
): ItemFile[] {
  return items.filter((item) => {
    if (isTagFilter(activeFilter)) {
      return !item.is_archived && item.tag_ids.includes(activeFilter.tagId);
    }
    if (isFolderFilter(activeFilter)) {
      if (item.is_archived) {
        return false;
      }
      const path = activeFilter.folderPath;
      return item.folder_path === path || item.folder_path.startsWith(`${path}/`);
    }
    if (activeFilter === "all" && item.is_archived) {
      return false;
    }
    if (activeFilter === "favorite" && !item.is_favorite) {
      return false;
    }
    if (activeFilter === "archived" && !item.is_archived) {
      return false;
    }
    return true;
  });
}
