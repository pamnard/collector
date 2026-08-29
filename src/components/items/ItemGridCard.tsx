import { memo, useMemo } from "react";
import type { TagWithCount } from "@collector/core";
import {
  positiveThumbnailPixelSize,
  type ItemThumbnailPixelSize,
} from "@collector/api";
import { cn } from "../../lib/utils";
import { useMainScrollElement } from "../../hooks/useMainScrollElement";
import { useNearViewportRef } from "../../hooks/useNearViewport";
import { ItemGridCardMeta } from "./ItemGridCardMeta";
import { textOnlyTeaserChromeClass } from "./text-only-teaser-chrome";
import {
  itemGridCoverImgClassName,
  itemGridCoverImgSizeAttrs,
  itemGridCoverOverlayLayout,
  itemGridCoverSlotAspectStyle,
  itemGridCoverSlotPending,
} from "./item-grid-cover-slot";
import { useItemGridCover } from "./use-item-grid-cover";
import {
  itemGridCardPropsAreEqual,
  type ItemGridCardProps,
} from "./item-grid-card-props";

function ItemGridCardInner({
  item,
  thumbnailPath,
  thumbnailSize,
  tagsById,
  onOpen,
}: ItemGridCardProps) {
  const scrollElement = useMainScrollElement();
  const { ref: nearViewportRef, nearViewport } = useNearViewportRef({
    root: scrollElement,
  });

  const tags = useMemo(
    () =>
      item.tag_ids
        .map((tagId) => tagsById.get(tagId))
        .filter((tag): tag is TagWithCount => Boolean(tag)),
    [item.tag_ids, tagsById],
  );

  const {
    coverSrc,
    coverSrcSet,
    coverSizes,
    coverPixelSize,
    coverPending,
    showCover,
    loadCover,
    onCoverImgLoad,
    onCoverImgError,
    onCoverImgRef,
  } = useItemGridCover({
    thumbnailPath,
    shouldDecode: nearViewport,
  });

  const slotSize: ItemThumbnailPixelSize | null =
    coverPixelSize ??
    positiveThumbnailPixelSize(
      thumbnailSize?.width,
      thumbnailSize?.height,
    );

  const coverSlotPending = itemGridCoverSlotPending({
    coverPending,
    resolvedPixelSize: slotSize,
  });
  const hasCover = showCover || coverSlotPending;
  if (showCover && !coverPixelSize) {
    throw new Error("settled grid cover requires reserved pixel size");
  }
  const overlayLayout = itemGridCoverOverlayLayout({ hasCover, slotSize });
  const decodingCover = Boolean(loadCover && coverSrc && !showCover);

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
      className={cn(
        "group flex cursor-pointer flex-col overflow-hidden",
        decodingCover && !hasCover && "relative",
        !hasCover && "h-full",
        !hasCover && textOnlyTeaserChromeClass,
        hasCover && overlayLayout && "relative h-full",
      )}
    >
      {decodingCover && coverSrc && !hasCover ? (
        <img
          ref={onCoverImgRef}
          src={coverSrc}
          srcSet={coverSrcSet ?? undefined}
          sizes={coverSizes ?? undefined}
          alt=""
          aria-hidden
          className="pointer-events-none absolute h-px w-px opacity-0"
          loading="eager"
          decoding="async"
          onLoad={(event) => onCoverImgLoad(event.currentTarget)}
          onError={onCoverImgError}
        />
      ) : null}
      {hasCover && slotSize ? (
        <div
          className={cn(
            "relative w-full overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-700",
            !overlayLayout && "mb-4 shrink-0",
          )}
          style={itemGridCoverSlotAspectStyle(slotSize)}
        >
          {(loadCover || showCover) && coverSrc ? (
            <img
              ref={onCoverImgRef}
              src={coverSrc}
              srcSet={coverSrcSet ?? undefined}
              sizes={coverSizes ?? undefined}
              alt=""
              {...itemGridCoverImgSizeAttrs(slotSize)}
              className={itemGridCoverImgClassName({
                loadCover: Boolean(loadCover && !showCover),
              })}
              loading="eager"
              decoding="async"
              onLoad={(event) => onCoverImgLoad(event.currentTarget)}
              onError={onCoverImgError}
            />
          ) : null}
          {!showCover ? (
            <div
              aria-hidden
              className="absolute inset-0 animate-pulse bg-neutral-100 dark:bg-neutral-700"
            />
          ) : null}
          {overlayLayout ? (
            <div className="absolute inset-x-0 bottom-0 flex flex-col bg-gradient-to-t from-neutral-950/95 via-neutral-950/75 to-transparent p-5 pt-16 dark:from-white/95 dark:via-white/75 dark:to-transparent">
              {meta}
            </div>
          ) : null}
        </div>
      ) : null}

      {!overlayLayout && meta}
    </div>
  );
}

export const ItemGridCard = memo(ItemGridCardInner, itemGridCardPropsAreEqual);
