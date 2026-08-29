import { memo, useMemo, useRef } from "react";
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
  itemGridCoverPulseClassName,
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

  // Host WxH from cover maps owns layout; decode natural size must not retarget
  // the slot (#913 / #799 / #874).
  const hostSize: ItemThumbnailPixelSize | null = positiveThumbnailPixelSize(
    thumbnailSize?.width,
    thumbnailSize?.height,
  );

  // While maps collapse (path undefined), keep the last reserved WxH so masonry
  // height does not drop to text-only then jump back (#913).
  const latchedHostSizeRef = useRef<ItemThumbnailPixelSize | null>(null);
  if (hostSize) {
    latchedHostSizeRef.current = hostSize;
  } else if (thumbnailPath === null) {
    latchedHostSizeRef.current = null;
  }
  const reservedSize: ItemThumbnailPixelSize | null =
    hostSize ??
    (thumbnailPath === undefined ? latchedHostSizeRef.current : null);

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
    reservedPixelSize: reservedSize,
    shouldDecode: nearViewport,
  });

  const slotSize: ItemThumbnailPixelSize | null =
    reservedSize ?? coverPixelSize;

  // Path unresolved but slot latched: keep reserved chrome without decode.
  const waitingWithLatch =
    thumbnailPath === undefined && reservedSize != null && !showCover;
  const coverSlotPending = itemGridCoverSlotPending({
    coverPending: coverPending || waitingWithLatch,
    resolvedPixelSize: slotSize,
  });
  const hasCover = showCover || coverSlotPending;
  if (showCover && !slotSize) {
    throw new Error("settled grid cover requires reserved pixel size");
  }
  const overlayLayout = itemGridCoverOverlayLayout({ hasCover, slotSize });

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
        !hasCover && "h-full",
        !hasCover && textOnlyTeaserChromeClass,
        hasCover && overlayLayout && "relative h-full",
      )}
    >
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
          {coverSlotPending || loadCover || showCover ? (
            <div
              aria-hidden
              className={itemGridCoverPulseClassName({ visible: !showCover })}
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
