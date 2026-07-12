import type { ItemFile } from "@collector/shared";
import type { TagWithCount } from "@collector/core";
import { ItemFlagActions } from "./ItemFlagActions";
import { ItemTagBadges } from "./ItemTagBadges";
import { ItemThumbnail } from "./ItemThumbnail";

interface ItemGridCardProps {
  item: ItemFile;
  tagsById: Map<string, TagWithCount>;
  onOpen: (itemId: string) => void;
  onUpdated: () => void;
}

export function ItemGridCard({
  item,
  tagsById,
  onOpen,
  onUpdated,
}: ItemGridCardProps) {
  return (
    <div
      className="rounded-xl border border-border bg-card overflow-hidden hover:border-indigo-500/40 hover:bg-input/20 transition-colors [content-visibility:auto] [contain-intrinsic-size:220px]"
    >
      <button
        type="button"
        onClick={() => onOpen(item.id)}
        className="block w-full text-left"
      >
        <ItemThumbnail item={item} />
      </button>
      <div className="flex items-start justify-between gap-2 p-4 pt-3">
        <button
          type="button"
          onClick={() => onOpen(item.id)}
          className="min-w-0 flex-1 text-left"
        >
          <p className="font-medium truncate">{item.title}</p>
          {item.description && (
            <p className="text-secondary text-sm mt-1 line-clamp-2">
              {item.description}
            </p>
          )}
          <ItemTagBadges tagIds={item.tag_ids} tagsById={tagsById} />
          <p className="text-muted text-xs mt-2">{item.content_type}</p>
        </button>
        <ItemFlagActions
          itemId={item.id}
          isFavorite={item.is_favorite}
          isArchived={item.is_archived}
          onUpdated={onUpdated}
          compact
        />
      </div>
    </div>
  );
}
