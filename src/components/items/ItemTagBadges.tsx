import type { TagWithCount } from "@collector/core";

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
        <span
          key={tag.id}
          className="rounded-full bg-input/50 px-2 py-0.5 text-sm text-secondary"
          style={tag.color ? { color: tag.color } : undefined}
        >
          {tag.name}
        </span>
      ))}
    </div>
  );
}
