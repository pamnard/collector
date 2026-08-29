import type { CSSProperties } from "react";
import { imageDisplaySlotById } from "../../lib/image-slot-fit";
import type { RelatedTeaser } from "../../lib/related-teaser";
import type { TeaserComposition } from "../../lib/teaser-layout/composition";
import { cn } from "../../lib/utils";
import { buildDerivedImageAttrs } from "../../utils/derived-image-src";
import { textOnlyTeaserChromeClass } from "./text-only-teaser-chrome";
import { formatItemDate } from "../../utils/formatItemDate";
import {
  ContentTypeIcon,
  contentTypeAccentClass,
} from "./content-type-icon";

const RELATED_SLOT_CSS_WIDTH_PX =
  imageDisplaySlotById("related-teaser").cssWidthPx;

type RelatedTeaserSlotProps = {
  teaser: RelatedTeaser;
  composition: TeaserComposition;
  onNavigate: (itemId: string) => void;
  style?: CSSProperties;
};

function titleClampClass(titleLen: TeaserComposition["titleLen"]): string {
  if (titleLen === "short") {
    return "line-clamp-1";
  }
  if (titleLen === "medium") {
    return "line-clamp-2";
  }
  if (titleLen === "long") {
    return "line-clamp-3";
  }
  throw new Error(`title clamp requires a title length bucket, got ${titleLen}`);
}

export function RelatedTeaserSlot({
  teaser,
  composition,
  onNavigate,
  style,
}: RelatedTeaserSlotProps) {
  const coverAttrs =
    composition.hasImage && teaser.thumbnail
      ? buildDerivedImageAttrs({
          displayPath: teaser.thumbnail,
          slotCssWidthPx: RELATED_SLOT_CSS_WIDTH_PX,
        })
      : null;
  const largeType = composition.span === "2x2" || !composition.hasImage;

  return (
    <button
      type="button"
      style={style}
      className={cn(
        "flex h-full min-h-0 w-full cursor-pointer flex-col overflow-hidden text-left",
        composition.hasImage ? null : textOnlyTeaserChromeClass,
        largeType ? "gap-2.5" : "gap-2",
      )}
      onClick={() => onNavigate(teaser.id)}
    >
      {coverAttrs ? (
        <span className="relative min-h-0 w-full flex-1 overflow-hidden rounded-lg">
          <img
            src={coverAttrs.src}
            srcSet={coverAttrs.srcSet}
            sizes={coverAttrs.sizes}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
        </span>
      ) : null}
      {composition.hasTitle ? (
        <span
          className={cn(
            "font-semibold text-neutral-900 dark:text-neutral-50",
            largeType ? "text-lg" : "text-sm",
            titleClampClass(composition.titleLen),
          )}
        >
          {teaser.title.trim() || teaser.id}
        </span>
      ) : null}
      {composition.desc !== "none" ? (
        <span
          className={cn(
            "text-neutral-600 dark:text-neutral-300",
            largeType ? "text-base" : "text-sm",
            composition.desc === "long" ? "line-clamp-3" : "line-clamp-2",
          )}
        >
          {teaser.description.trim()}
        </span>
      ) : null}
      {composition.extra !== "none" ? (
        <span
          className={cn(
            "mt-auto flex items-center gap-2 leading-none text-neutral-500 dark:text-neutral-400",
            largeType ? "text-sm" : "text-xs",
          )}
        >
          {composition.extra === "date_type" ? (
            <span className={contentTypeAccentClass(teaser.contentType)}>
              <ContentTypeIcon
                type={teaser.contentType}
                size={largeType ? 16 : 14}
              />
            </span>
          ) : null}
          <span>{formatItemDate(teaser.createdAt)}</span>
        </span>
      ) : null}
    </button>
  );
}
