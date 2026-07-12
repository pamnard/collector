import type { ItemFile } from "@collector/shared";
import type { NavFilter } from "../types/ui";

export function filterItems(
  items: ItemFile[],
  activeFilter: NavFilter,
  searchQuery: string,
): ItemFile[] {
  const query = searchQuery.trim().toLowerCase();

  return items.filter((item) => {
    if (activeFilter === "all" && item.is_archived) {
      return false;
    }
    if (activeFilter === "favorite" && !item.is_favorite) {
      return false;
    }
    if (activeFilter === "archived" && !item.is_archived) {
      return false;
    }

    if (!query) {
      return true;
    }

    return (
      item.title.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query)
    );
  });
}
