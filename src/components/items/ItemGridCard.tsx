import { memo, useMemo } from "react";
import type { ItemFile } from "@collector/shared";
import type { TagWithCount } from "@collector/core";
import { cn } from "../../lib/utils";
import { itemCoverStamp } from "../../lib/dashboard-commit";
import { useMainScrollElement } from "../../hooks/useMainScrollElement";
import { useNearViewport } from "../../hooks/useNearViewport";
import { ItemGridCardMeta } from "./ItemGridCardMeta";
import { textOnlyTeaserChromeClass } from "./text-only-teaser-chrome";
import {
  COVER_DECODE_ROOT_MARGIN,
  ITEM_GRID_COVER_IMG_LOADING,
} from "./item-grid-cover-decode";
import { itemGridCoverSlotPending } from "./item-grid-cover-slot";
import { useItemGridCover } from "./use-item-grid-cover";

interface ItemGridCardProps {
  item: ItemFile;
  /** undefined = paths still resolving; null = no file cover; string = path */
  thumbnailPath?: string | null;
  tagsById: Map<string, TagWithCount>;
  onOpen: (itemId: string) => void;
}

function itemGridCardPropsEqual(
  prev: ItemGridCardProps,
  next: ItemGridCardProps,
): boolean {
  return (
    prev.item.id === next.item.id &&
    itemCoverStamp(prev.item) === itemCoverStamp(next.item) &&
    prev.thumbnailPath === next.thumbnailPath &&
    prev.item.title === next.item.title &&
    prev.item.description === next.item.description &&
    prev.item.content_type === next.item.content_type &&
    prev.item.created_at === next.item.created_at &&
    prev.item.url === next.item.url &&
    prev.item.tag_ids === next.item.tag_ids &&
    prev.tagsById === next.tagsById &&
    prev.onOpen === next.onOpen
  );
}

function ItemGridCardComponent({
  item,
  thumbnailPath,
  tagsById,
  onOpen,
}: ItemGridCardProps) {
  const scrollElement = useMainScrollElement();
  const { setNode, nearViewport } = useNearViewport({
    root: scrollElement,
    rootMargin: COVER_DECODE_ROOT_MARGIN,
  });

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
    nearViewport,
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
      ref={setNode}
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
          {showCover ? (
            <img
              src={coverSrc!}
              alt=""
              className="h-auto w-full"
              loading={ITEM_GRID_COVER_IMG_LOADING}
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

export const ItemGridCard = memo(ItemGridCardComponent, itemGridCardPropsEqual);
