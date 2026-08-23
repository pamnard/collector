import type { TagWithCount } from "@collector/core";
import type { ItemFile } from "@collector/shared";
import { formatItemDate } from "../../../utils/formatItemDate";
import { ItemTagBadges } from "../ItemTagBadges";
import { ItemRowActions } from "./ItemRowActions";

export function ItemTableTitleCell({ item }: { item: ItemFile }) {
  return <p className="truncate font-medium">{item.title}</p>;
}

export function ItemTableDateCell({ value }: { value: string }) {
  return (
    <span className="text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
      {formatItemDate(value)}
    </span>
  );
}

export function ItemTableContentTypeCell({ item }: { item: ItemFile }) {
  return (
    <span className="text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
      {item.content_type}
    </span>
  );
}

export function ItemTableTagsCell({
  item,
  tagsById,
}: {
  item: ItemFile;
  tagsById: Map<string, TagWithCount>;
}) {
  return <ItemTagBadges tagIds={item.tag_ids} tagsById={tagsById} />;
}

export function ItemTableActionsCell({
  item,
  onUpdated,
}: {
  item: ItemFile;
  onUpdated?: () => void;
}) {
  return (
    <ItemRowActions
      itemId={item.id}
      itemTitle={item.title}
      onUpdated={onUpdated}
    />
  );
}
