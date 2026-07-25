import type { TagWithCount } from "@collector/core";
import { Badge } from "@/components/ui/badge";

interface ItemTagBadgesProps {
  tagIds: string[];
  tagsById: Map<string, TagWithCount>;
}

export function ItemTagBadges({ tagIds, tagsById }: ItemTagBadgesProps) {
  const visibleTags = tagIds
    .map((tagId) => tagsById.get(tagId))
    .filter((tag): tag is TagWithCount => Boolean(tag));

  if (!visibleTags.length) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {visibleTags.map((tag) => (
        <Badge
          key={tag.id}
          variant="outline"
          style={tag.color ? { color: tag.color } : undefined}
        >
          {tag.name}
        </Badge>
      ))}
    </div>
  );
}
