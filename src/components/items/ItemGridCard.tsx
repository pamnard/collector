import { memo, useMemo } from "react";
import type { ItemFile } from "@collector/shared";
import type { TagWithCount } from "@collector/core";
import { itemCoverStamp } from "../../lib/dashboard-commit";
import { cn } from "../../lib/utils";
import { ItemGridCardMeta } from "./ItemGridCardMeta";
import {
  COVER_IMG_LOADING_PRIORITY,
  itemGridCardMemoSnapshot,
  itemGridCardMemoSnapshotsEqual,
} from "./item-grid-cover-decode";
import { itemGridCoverSlotPending } from "./item-grid-cover-slot";
import { textOnlyTeaserChromeClass } from "./text-only-teaser-chrome";
import { useItemGridCover } from "./use-item-grid-cover";
import { useNearViewport } from "./use-near-viewport";

export interface ItemGridCardProps {
  item: ItemFile;
  /** undefined = paths still resolving; null = no file cover; string = path */
  thumbnailPath?: string | null;
  tagsById: Map<string, TagWithCount>;
  onOpen: (itemId: string) => void;
  scrollRoot: Element | null;
}

export function itemGridCardPropsEqual(
  prev: ItemGridCardProps,
  next: ItemGridCardProps,
): boolean {
  if (
    prev.tagsById !== next.tagsById ||
    prev.onOpen !== next.onOpen ||
    prev.scrollRoot !== next.scrollRoot
  ) {
    return false;
  }
  return itemGridCardMemoSnapshotsEqual(
    itemGridCardMemoSnapshot({
      id: prev.item.id,
      coverStamp: itemCoverStamp(prev.item),
      thumbnailPath: prev.thumbnailPath,
      title: prev.item.title,
      description: prev.item.description,
      contentType: prev.item.content_type,
      createdAt: prev.item.created_at,
      url: prev.item.url,
      tagIds: prev.item.tag_ids,
    }),
    itemGridCardMemoSnapshot({
      id: next.item.id,
      coverStamp: itemCoverStamp(next.item),
      thumbnailPath: next.thumbnailPath,
      title: next.item.title,
      description: next.item.description,
      contentType: next.item.content_type,
      createdAt: next.item.created_at,
      url: next.item.url,
      tagIds: next.item.tag_ids,
    }),
  );
}

function ItemGridCardInner({
  item,
  thumbnailPath,
  tagsById,
  onOpen,
  scrollRoot,
}: ItemGridCardProps) {
  const [observeRef, nearViewport] = useNearViewport(scrollRoot);
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
    attachSrc,
    attachCover,
    isPortraitCover,
    coverPending,
    showCover,
    pathUnresolved,
    onCoverLoad,
    onCoverError,
  } = useItemGridCover({
    thumbnailPath,
    itemUrl: item.url ?? undefined,
    optimisticPortrait,
    decodePriority: nearViewport,
  });

  // Notes must not show an empty gray teaser while cover paths resolve.
  const coverSlotPending = itemGridCoverSlotPending({
    coverPending,
    pathUnresolved,
    optimisticPortrait,
  });
  const hasCover = showCover || coverSlotPending;
  const overlayLayout = Boolean(
    (showCover && isPortraitCover) || (coverSlotPending && optimisticPortrait),
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
      ref={observeRef}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(item.id);
        }
      }}
      // No content-visibility / contain-intrinsic-size: WebKitGTK (Tauri Linux)
      // leaves those masonry cards as blank 280px boxes.
      className={cn(
        "group flex cursor-pointer flex-col overflow-hidden",
        !hasCover && "h-full",
        !hasCover && textOnlyTeaserChromeClass,
        hasCover && overlayLayout && "relative h-full",
      )}
    >
      {hasCover && (
        <div
          className={cn(
            "relative overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-700",
            !overlayLayout && "mb-4 shrink-0",
          )}
        >
          {attachCover && attachSrc ? (
            <img
              key={attachSrc}
              src={attachSrc}
              alt=""
              className={cn(
                "h-auto w-full",
                !showCover &&
                  "pointer-events-none absolute inset-x-0 top-0 opacity-0",
              )}
              loading={COVER_IMG_LOADING_PRIORITY}
              decoding="async"
              onLoad={(event) => onCoverLoad(event.currentTarget)}
              onError={(event) => onCoverError(event.currentTarget)}
            />
          ) : null}
          {!showCover ? (
            <div
              aria-hidden
              className={
                overlayLayout
                  ? "aspect-[3/4] w-full animate-pulse bg-neutral-100 dark:bg-neutral-700"
                  : "aspect-video w-full animate-pulse bg-neutral-100 dark:bg-neutral-700"
              }
            />
          ) : null}
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

export const ItemGridCard = memo(ItemGridCardInner, itemGridCardPropsEqual);
