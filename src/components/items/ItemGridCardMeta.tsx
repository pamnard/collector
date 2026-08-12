import type { TagWithCount } from "@collector/core";
import { Badge } from "@/components/ui/badge";
import { formatItemDate } from "../../utils/formatItemDate";
import {
  ContentTypeIcon,
  contentTypeAccentClass,
} from "./content-type-icon";

interface ItemGridCardMetaProps {
  title: string;
  description?: string | null;
  contentType: string;
  createdAt: string;
  tags: TagWithCount[];
  overlayLayout: boolean;
}

export function ItemGridCardMeta({
  title,
  description,
  contentType,
  createdAt,
  tags,
  overlayLayout,
}: ItemGridCardMetaProps) {
  if (overlayLayout) {
    return (
      <>
        <h3 className="mb-2 line-clamp-3 text-lg font-bold leading-snug text-white dark:text-neutral-900">
          {title}
        </h3>

        {description ? (
          <p className="mb-4 line-clamp-3 flex-1 text-sm text-white/80 dark:text-neutral-700">
            {description}
          </p>
        ) : null}

        {tags.length > 0 ? (
          <div className="mt-auto flex flex-wrap gap-2">
            {tags.slice(0, 3).map((tag) => (
              <Badge
                key={tag.id}
                variant="outline"
                className="border-white/25 bg-white/15 text-white dark:border-neutral-900/20 dark:bg-neutral-900/10 dark:text-neutral-800"
              >
                {tag.name}
              </Badge>
            ))}
            {tags.length > 3 ? (
              <Badge
                variant="outline"
                className="border-white/25 bg-white/15 text-white dark:border-neutral-900/20 dark:bg-neutral-900/10 dark:text-neutral-800"
              >
                +{tags.length - 3}
              </Badge>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 flex items-center text-sm leading-none text-white/70 dark:text-neutral-600">
          <div className="flex items-center gap-2">
            <span className={contentTypeAccentClass(contentType)}>
              <ContentTypeIcon type={contentType} size={16} />
            </span>
            <span>{formatItemDate(createdAt)}</span>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2">
        <h3 className="line-clamp-3 text-lg font-bold leading-snug text-neutral-900 dark:text-neutral-100">
          {title}
        </h3>

        {description ? (
          <p className="line-clamp-3 text-sm text-neutral-500 dark:text-neutral-400">
            {description}
          </p>
        ) : null}

        {tags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {tags.slice(0, 3).map((tag) => (
              <Badge
                key={tag.id}
                variant="outline"
                style={tag.color ? { color: tag.color } : undefined}
              >
                {tag.name}
              </Badge>
            ))}
            {tags.length > 3 ? (
              <Badge variant="outline">+{tags.length - 3}</Badge>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex items-center text-sm leading-none text-neutral-500 dark:text-neutral-400">
        <div className="flex items-center gap-2">
          <span className={contentTypeAccentClass(contentType)}>
            <ContentTypeIcon type={contentType} size={16} />
          </span>
          <span>{formatItemDate(createdAt)}</span>
        </div>
      </div>
    </div>
  );
}
