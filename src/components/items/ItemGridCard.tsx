import { convertFileSrc } from "@tauri-apps/api/core";
import {
  FileText,
  Image as ImageIcon,
  Link as LinkIcon,
  Music,
  Video,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ItemFile } from "@collector/shared";
import type { TagWithCount } from "@collector/core";
import { ItemFlagActions } from "./ItemFlagActions";
import { resolveItemThumbnailPath } from "../../services/collector-service";
import { formatItemDate } from "../../utils/formatItemDate";
import { getYouTubeThumbnail } from "../../utils/youtube-thumbnail";

interface ItemGridCardProps {
  item: ItemFile;
  tagsById: Map<string, TagWithCount>;
  onOpen: (itemId: string) => void;
  onUpdated: () => void;
}

function toCoverDisplaySrc(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  return convertFileSrc(pathOrUrl);
}

function iconForContentType(type: string) {
  switch (type) {
    case "image":
      return <ImageIcon size={16} />;
    case "video":
      return <Video size={16} />;
    case "audio":
      return <Music size={16} />;
    case "article":
    case "pdf":
    case "document":
      return <FileText size={16} />;
    default:
      return <LinkIcon size={16} />;
  }
}

export function ItemGridCard({
  item,
  tagsById,
  onOpen,
  onUpdated,
}: ItemGridCardProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [coverSrc, setCoverSrc] = useState<string | null>(null);
  const [isMediaLoaded, setIsMediaLoaded] = useState(false);

  const tags = useMemo(
    () =>
      item.tag_ids
        .map((tagId) => tagsById.get(tagId))
        .filter((tag): tag is TagWithCount => Boolean(tag)),
    [item.tag_ids, tagsById],
  );

  useEffect(() => {
    let cancelled = false;
    setIsMediaLoaded(false);
    setCoverSrc(null);

    void (async () => {
      const thumbnailPath = await resolveItemThumbnailPath(item).catch(() => null);
      if (cancelled) {
        return;
      }

      if (thumbnailPath) {
        setCoverSrc(toCoverDisplaySrc(thumbnailPath));
        return;
      }

      if (item.url) {
        const youtube = getYouTubeThumbnail(item.url);
        if (youtube) {
          setCoverSrc(youtube);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [item]);

  useEffect(() => {
    if (coverSrc && imgRef.current?.complete) {
      setIsMediaLoaded(true);
    }
  }, [coverSrc]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(item.id);
        }
      }}
      className="group flex h-full cursor-pointer flex-col rounded-xl border border-border-card bg-card p-5 transition-all duration-300 hover:border-indigo-500/50 hover:shadow-lg hover:shadow-indigo-500/10 [content-visibility:auto] [contain-intrinsic-size:280px]"
    >
      {coverSrc && (
        <div className="relative -mx-5 -mt-5 mb-4 overflow-hidden rounded-t-xl bg-input">
          {!isMediaLoaded && (
            <div className="absolute inset-0 z-10 animate-pulse bg-gray-200 dark:bg-gray-700" />
          )}
          <img
            ref={imgRef}
            src={coverSrc}
            alt=""
            className={`w-full h-auto transition-transform duration-500 group-hover:scale-105 ${
              isMediaLoaded ? "opacity-100" : "min-h-[200px] opacity-0"
            }`}
            loading="lazy"
            onLoad={() => setIsMediaLoaded(true)}
          />
        </div>
      )}

      <h3 className="mb-2 text-lg font-bold leading-snug text-primary">
        {item.title}
      </h3>

      {item.description && (
        <p className="mb-4 line-clamp-3 flex-1 text-sm text-secondary">
          {item.description}
        </p>
      )}

      {tags.length > 0 && (
        <div className="mt-auto flex flex-wrap gap-2">
          {tags.slice(0, 3).map((tag) => (
            <span
              key={tag.id}
              className="rounded-md border border-border bg-input px-2 py-1 text-xs text-secondary"
              style={tag.color ? { color: tag.color } : undefined}
            >
              #{tag.name}
            </span>
          ))}
          {tags.length > 3 && (
            <span className="rounded-md border border-border bg-input px-2 py-1 text-xs text-secondary">
              +{tags.length - 3}
            </span>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-border-card pt-4 text-xs text-muted">
        <div className="flex items-center gap-2">
          <span
            className={
              item.content_type === "image" ? "text-purple-400" : "text-indigo-400"
            }
          >
            {iconForContentType(item.content_type)}
          </span>
          <span>{formatItemDate(item.created_at)}</span>
        </div>

        <div
          className="opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <ItemFlagActions
            itemId={item.id}
            isFavorite={item.is_favorite}
            isArchived={item.is_archived}
            onUpdated={onUpdated}
            compact
          />
        </div>
      </div>
    </div>
  );
}
