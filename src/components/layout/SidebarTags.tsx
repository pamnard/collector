import { Hash } from "lucide-react";
import type { TagWithCount } from "@collector/core";
import type { NavFilter } from "../../types/ui";
import { navFilterKey } from "../../types/ui";

interface SidebarTagsProps {
  tags: TagWithCount[];
  activeFilter: NavFilter;
  isSettings: boolean;
  onSelect: (filter: NavFilter) => void;
}

export function SidebarTags({
  tags,
  activeFilter,
  isSettings,
  onSelect,
}: SidebarTagsProps) {
  const activeKey = navFilterKey(activeFilter);

  if (tags.length === 0) {
    return (
      <p className="px-4 py-2 text-sm text-neutral-500">Тегов пока нет</p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2 px-2">
      {tags.map((tag) => {
        const selected =
          !isSettings &&
          activeKey === navFilterKey({ type: "tag", tagId: tag.id });
        return (
          <button
            key={tag.id}
            type="button"
            onClick={() => onSelect({ type: "tag", tagId: tag.id })}
            className={`flex items-center gap-1 text-sm transition-colors ${
              selected
                ? "text-indigo-600 dark:text-indigo-400"
                : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
            }`}
          >
            <Hash size={16} />
            <span className="truncate max-w-[150px]">{tag.name}</span>
          </button>
        );
      })}
    </div>
  );
}
