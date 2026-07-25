import type { TagWithCount } from "@collector/core";
import { Badge } from "@/components/ui/badge";
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
          <Badge
            key={tag.id}
            variant={selected ? "default" : "outline"}
            render={
              <button
                type="button"
                onClick={() => onSelect({ type: "tag", tagId: tag.id })}
              />
            }
          >
            <span className="truncate max-w-[150px]">{tag.name}</span>
            <span className="tabular-nums opacity-70">{tag.item_count}</span>
          </Badge>
        );
      })}
    </div>
  );
}
