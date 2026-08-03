import { useMemo } from "react";
import type { ItemFile } from "@collector/shared";
import type { TagWithCount } from "@collector/core";
import { ItemGridCardMeta } from "./ItemGridCardMeta";
import { useItemGridCover } from "./use-item-grid-cover";

interface ItemGridCardProps {
  item: ItemFile;
  /** undefined = paths still resolving; null = no file cover; string = path */
  thumbnailPath?: string | null;
  tagsById: Map<string, TagWithCount>;
  onOpen: (itemId: string) => void;
}

export function ItemGridCard({
  item,
  thumbnailPath,
  tagsById,
  onOpen,
}: ItemGridCardProps) {
  const optimisticPortrait =
    item.content_type === "image" || item.content_type === "video";

  const tags = useMemo(
    () =>
      item.tag_ids
        .map((tagId) => tagsById.get(tagId))
        .filter((tag): tag is TagWithCount => Boolean(tag)),
    [item.tag_ids, tagsById],
  );

  const {
    coverSrc,
    isPortraitCover,
    coverPending,
    showCover,
    pathUnresolved,
  } = useItemGridCover({
    thumbnailPath,
    itemUrl: item.url ?? undefined,
    optimisticPortrait,
  });

  // Only while dashboard paths are unresolved. Once path is known, keep card chrome
  // mounted — pulse→fade was the second ms-blink on image-heavy folder switches.
  if (pathUnresolved) {
    return (
      <div
        aria-hidden
        className="min-h-[280px] animate-pulse rounded-lg border border-black/10 dark:border-white/10 bg-white/50 dark:bg-neutral-800/50"
      />
    );
  }

  const overlayLayout = Boolean(
    (showCover && isPortraitCover) || (coverPending && optimisticPortrait),
  );

  const meta = (
    <ItemGridCardMeta
      title={item.title}
      description={item.description}
      contentType={item.content_type}
      createdAt={item.created_at}
      tags={tags}
      overlayLayout={overlayLayout}
    />
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
          ? "group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-800 hover:border-indigo-500/50 dark:hover:border-indigo-500/50 hover:shadow-lg hover:shadow-indigo-500/10 [content-visibility:auto] [contain-intrinsic-size:280px]"
          : "group flex h-full cursor-pointer flex-col rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-800 p-5 hover:border-indigo-500/50 dark:hover:border-indigo-500/50 hover:shadow-lg hover:shadow-indigo-500/10 [content-visibility:auto] [contain-intrinsic-size:280px]"
      }
    >
      {(showCover || coverPending) && (
        <div
          className={
            overlayLayout
              ? "relative overflow-hidden bg-neutral-100 dark:bg-neutral-700"
              : "relative -mx-5 -mt-5 mb-4 overflow-hidden rounded-t-lg bg-neutral-100 dark:bg-neutral-700"
          }
        >
          {showCover ? (
            <img
              src={coverSrc!}
              alt=""
              className="h-auto w-full"
              loading="eager"
              decoding="async"
            />
          ) : (
            <div
              aria-hidden
              className={
                overlayLayout
                  ? "aspect-[3/4] w-full animate-pulse bg-neutral-100 dark:bg-neutral-700"
                  : "aspect-video w-full animate-pulse bg-neutral-100 dark:bg-neutral-700"
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
