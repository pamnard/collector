import { memo, useMemo } from "react";
import type { TagWithCount } from "@collector/core";
import { cn } from "../../lib/utils";
import { useMainScrollElement } from "../../hooks/useMainScrollElement";
import { useNearViewportRef } from "../../hooks/useNearViewport";
import { ItemGridCardMeta } from "./ItemGridCardMeta";
import { textOnlyTeaserChromeClass } from "./text-only-teaser-chrome";
import { itemGridCoverSlotPending } from "./item-grid-cover-slot";
import { useItemGridCover } from "./use-item-grid-cover";
import {
  itemGridCardPropsAreEqual,
  type ItemGridCardProps,
} from "./item-grid-card-props";

function ItemGridCardInner({
  item,
  thumbnailPath,
  tagsById,
  onOpen,
}: ItemGridCardProps) {
  const scrollElement = useMainScrollElement();
  const { ref: nearViewportRef, nearViewport } = useNearViewportRef({
    root: scrollElement,
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
    loadCover,
    pathUnresolved,
    onCoverImgLoad,
    onCoverImgError,
    onCoverImgRef,
  } = useItemGridCover({
    thumbnailPath,
    itemUrl: item.url ?? undefined,
    optimisticPortrait,
    shouldDecode: nearViewport,
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
      ref={nearViewportRef}
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
          {(loadCover || showCover) && coverSrc ? (
            <img
              ref={onCoverImgRef}
              src={coverSrc}
              alt=""
              className={cn(
                "h-auto w-full",
                loadCover && "opacity-0",
              )}
              loading="eager"
              decoding="async"
              onLoad={(event) => onCoverImgLoad(event.currentTarget)}
              onError={onCoverImgError}
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

export const ItemGridCard = memo(ItemGridCardInner, itemGridCardPropsAreEqual);
