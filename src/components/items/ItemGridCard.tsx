import { memo, useMemo } from "react";
import type { TagWithCount } from "@collector/core";
import { cn } from "../../lib/utils";
import { useMainScrollElement } from "../../hooks/useMainScrollElement";
import { useNearViewportRef } from "../../hooks/useNearViewport";
import { ItemGridCardMeta } from "./ItemGridCardMeta";
import { textOnlyTeaserChromeClass } from "./text-only-teaser-chrome";
import { itemGridCoverImgClassName } from "./item-grid-cover-slot";
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
    showCover,
    loadCover,
    onCoverImgLoad,
    onCoverImgError,
    onCoverImgRef,
  } = useItemGridCover({
    thumbnailPath,
    itemUrl: item.url ?? undefined,
    shouldDecode: nearViewport,
  });

  // Cover chrome only after a successful settle — pending/timeout/error = text teaser.
  const hasCover = showCover;
  const overlayLayout = Boolean(showCover && isPortraitCover);
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
      // No content-visibility / contain-intrinsic-size: WebKitGTK (Tauri Linux)
      // leaves those masonry cards as blank 280px boxes.
      className={cn(
        "group flex cursor-pointer flex-col overflow-hidden",
        decodingCover && "relative",
        !hasCover && "h-full",
        !hasCover && textOnlyTeaserChromeClass,
        hasCover && overlayLayout && "relative h-full",
      )}
    >
      {decodingCover && coverSrc ? (
        <img
          ref={onCoverImgRef}
          src={coverSrc}
          alt=""
          aria-hidden
          className="pointer-events-none absolute h-px w-px opacity-0"
          loading="eager"
          decoding="async"
          onLoad={(event) => onCoverImgLoad(event.currentTarget)}
          onError={onCoverImgError}
        />
      ) : null}
      {hasCover && coverSrc ? (
        <div
          className={cn(
            "relative overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-700",
            !overlayLayout && "mb-4 shrink-0",
          )}
        >
          <img
            ref={onCoverImgRef}
            src={coverSrc}
            alt=""
            className={itemGridCoverImgClassName({ loadCover: false })}
            loading="eager"
            decoding="async"
            onLoad={(event) => onCoverImgLoad(event.currentTarget)}
            onError={onCoverImgError}
          />
          {overlayLayout && (
            <div className="absolute inset-x-0 bottom-0 flex flex-col bg-gradient-to-t from-neutral-950/95 via-neutral-950/75 to-transparent p-5 pt-16 dark:from-white/95 dark:via-white/75 dark:to-transparent">
              {meta}
            </div>
          )}
        </div>
      ) : null}

      {!overlayLayout && meta}
    </div>
  );
}

export const ItemGridCard = memo(ItemGridCardInner, itemGridCardPropsAreEqual);
