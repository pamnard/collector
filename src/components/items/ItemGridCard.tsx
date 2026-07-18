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
import { toDisplayAssetSrc } from "../../utils/asset-src";
import { formatItemDate } from "../../utils/formatItemDate";
import { getYouTubeThumbnail } from "../../utils/youtube-thumbnail";

/** Cover is portrait when height/width >= this (1.2 ≈ «чуть выше квадрата»). */
const PORTRAIT_COVER_RATIO = 1.2;

interface ItemGridCardProps {
  item: ItemFile;
  /** undefined = paths still resolving; null = no file cover; string = path */
  thumbnailPath?: string | null;
  tagsById: Map<string, TagWithCount>;
  onOpen: (itemId: string) => void;
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

function isPortraitNaturalSize(img: HTMLImageElement): boolean {
  if (img.naturalWidth === 0) {
    return false;
  }
  return img.naturalHeight / img.naturalWidth >= PORTRAIT_COVER_RATIO;
}

function resolveCoverSrc(
  thumbnailPath: string | null,
  itemUrl: string | undefined,
): string | null {
  if (thumbnailPath) {
    return toDisplayAssetSrc(thumbnailPath);
  }
  if (itemUrl) {
    return getYouTubeThumbnail(itemUrl);
  }
  return null;
}

export function ItemGridCard({
  item,
  thumbnailPath,
  tagsById,
  onOpen,
}: ItemGridCardProps) {
  const optimisticPortrait =
    item.content_type === "image" || item.content_type === "video";
  const [coverSrc, setCoverSrc] = useState<string | null>(null);
  const [isMediaLoaded, setIsMediaLoaded] = useState(false);
  const [isPortraitCover, setIsPortraitCover] = useState(optimisticPortrait);
  const coverSrcRef = useRef(coverSrc);

  const tags = useMemo(
    () =>
      item.tag_ids
        .map((tagId) => tagsById.get(tagId))
        .filter((tag): tag is TagWithCount => Boolean(tag)),
    [item.tag_ids, tagsById],
  );

  const expectedCoverSrc =
    thumbnailPath === undefined
      ? null
      : resolveCoverSrc(thumbnailPath, item.url ?? undefined);
  const coverPending = Boolean(expectedCoverSrc) && !isMediaLoaded;

  useEffect(() => {
    coverSrcRef.current = coverSrc;
  }, [coverSrc]);

  useEffect(() => {
    // Path still resolving — wait; do not tear down chrome once path is known.
    if (thumbnailPath === undefined) {
      return;
    }

    const src = resolveCoverSrc(thumbnailPath, item.url ?? undefined);
    if (src === coverSrcRef.current) {
      return;
    }

    setCoverSrc(null);
    setIsMediaLoaded(false);
    setIsPortraitCover(optimisticPortrait);

    if (!src) {
      return;
    }

    let cancelled = false;
    let settled = false;
    const img = new Image();
    const finish = (next: {
      src: string | null;
      loaded: boolean;
      portrait: boolean;
    }) => {
      if (cancelled || settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      setCoverSrc(next.src);
      setIsMediaLoaded(next.loaded);
      setIsPortraitCover(next.portrait);
    };
    const timer = setTimeout(() => {
      console.warn("[ItemGridCard] cover decode timed out", { src });
      finish({ src: null, loaded: false, portrait: false });
    }, 4_000);
    img.onload = () => {
      finish({
        src,
        loaded: true,
        portrait: isPortraitNaturalSize(img),
      });
    };
    img.onerror = () => {
      finish({ src: null, loaded: false, portrait: false });
    };
    img.src = src;

    return () => {
      cancelled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
    };
  }, [item.url, optimisticPortrait, thumbnailPath]);

  // Only while dashboard paths are unresolved. Once path is known, keep card chrome
  // mounted — pulse→fade was the second ms-blink on image-heavy folder switches.
  if (thumbnailPath === undefined) {
    return (
      <div
        aria-hidden
        className="min-h-[280px] animate-pulse rounded-lg border border-border-card bg-card/50"
      />
    );
  }

  const showCover = Boolean(coverSrc && isMediaLoaded);
  const overlayLayout = Boolean(
    (showCover && isPortraitCover) || (coverPending && optimisticPortrait),
  );

  const meta = (
    <>
      <h3
        className={
          overlayLayout
            ? "mb-2 line-clamp-3 text-lg font-bold leading-snug text-white dark:text-neutral-900"
            : "mb-2 line-clamp-3 text-lg font-bold leading-snug text-primary"
        }
      >
        {item.title}
      </h3>

      {item.description && (
        <p
          className={
            overlayLayout
              ? "mb-4 line-clamp-3 flex-1 text-sm text-white/80 dark:text-neutral-700"
              : "mb-4 line-clamp-3 flex-1 text-sm text-secondary"
          }
        >
          {item.description}
        </p>
      )}

      {tags.length > 0 && (
        <div className="mt-auto flex flex-wrap gap-2">
          {tags.slice(0, 3).map((tag) => (
            <span
              key={tag.id}
              className={
                overlayLayout
                  ? "rounded-md border border-white/25 bg-white/15 px-2 py-1 text-sm text-white dark:border-neutral-900/20 dark:bg-neutral-900/10 dark:text-neutral-800"
                  : "rounded-md border border-border bg-input px-2 py-1 text-sm text-secondary"
              }
              style={
                !overlayLayout && tag.color ? { color: tag.color } : undefined
              }
            >
              #{tag.name}
            </span>
          ))}
          {tags.length > 3 && (
            <span
              className={
                overlayLayout
                  ? "rounded-md border border-white/25 bg-white/15 px-2 py-1 text-sm text-white dark:border-neutral-900/20 dark:bg-neutral-900/10 dark:text-neutral-800"
                  : "rounded-md border border-border bg-input px-2 py-1 text-sm text-secondary"
              }
            >
              +{tags.length - 3}
            </span>
          )}
        </div>
      )}

      <div
        className={
          overlayLayout
            ? "mt-4 flex items-center text-sm leading-none text-white/70 dark:text-neutral-600"
            : "mt-4 flex items-center text-sm leading-none text-muted"
        }
      >
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
      </div>
    </>
  );

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
      className={
        overlayLayout
          ? "group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-lg border border-border-card bg-card hover:border-indigo-500/50 hover:shadow-lg hover:shadow-indigo-500/10 [content-visibility:auto] [contain-intrinsic-size:280px]"
          : "group flex h-full cursor-pointer flex-col rounded-lg border border-border-card bg-card p-5 hover:border-indigo-500/50 hover:shadow-lg hover:shadow-indigo-500/10 [content-visibility:auto] [contain-intrinsic-size:280px]"
      }
    >
      {(showCover || coverPending) && (
        <div
          className={
            overlayLayout
              ? "relative overflow-hidden bg-input"
              : "relative -mx-5 -mt-5 mb-4 overflow-hidden rounded-t-lg bg-input"
          }
        >
          {showCover ? (
            <img
              src={coverSrc!}
              alt=""
              className="h-auto w-full transition-transform duration-500 group-hover:scale-105"
              loading="eager"
              decoding="async"
            />
          ) : (
            <div
              aria-hidden
              className={
                overlayLayout
                  ? "aspect-[3/4] w-full animate-pulse bg-input"
                  : "aspect-video w-full animate-pulse bg-input"
              }
            />
          )}
          {overlayLayout && (
            <div className="absolute inset-x-0 bottom-0 flex flex-col bg-gradient-to-t from-neutral-950/95 via-neutral-950/75 to-transparent p-5 pt-16 dark:from-white/95 dark:via-white/75 dark:to-transparent">
              {meta}
            </div>
          )}
        </div>
      )}

      {!overlayLayout && meta}
    </div>
  );
}
