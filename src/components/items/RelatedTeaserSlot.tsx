import type { CSSProperties } from "react";
import type { RelatedTeaser } from "../../lib/related-teaser";
import type { TeaserComposition } from "../../lib/teaser-layout/composition";
import { formatItemDate } from "../../utils/formatItemDate";
import {
  ContentTypeIcon,
  contentTypeAccentClass,
} from "./content-type-icon";

type RelatedTeaserSlotProps = {
  teaser: RelatedTeaser;
  composition: TeaserComposition;
  onNavigate: (itemId: string) => void;
  style?: CSSProperties;
};

function coverAspectClass(form: TeaserComposition["form"]): string {
  if (form === "square") {
    return "aspect-square";
  }
  if (form === "portrait") {
    return "aspect-[3/4] max-w-[72%]";
  }
  if (form === "landscape") {
    return "aspect-video";
  }
  throw new Error(`cover form requires an image form, got ${form}`);
}

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
  const coverSrc = composition.hasImage ? teaser.thumbnail : null;

  return (
    <button
      type="button"
      style={style}
      className="flex h-full min-h-0 w-full cursor-pointer flex-col gap-2 rounded-md p-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-900/40"
      onClick={() => onNavigate(teaser.id)}
    >
      {coverSrc ? (
        <img
          src={coverSrc}
          alt=""
          className={`w-full rounded object-cover ${coverAspectClass(composition.form)}`}
          loading="lazy"
        />
      ) : null}
      {composition.hasTitle ? (
        <span
          className={`text-sm font-semibold text-neutral-900 dark:text-neutral-50 ${titleClampClass(composition.titleLen)}`}
        >
          {teaser.title.trim() || teaser.id}
        </span>
      ) : null}
      {composition.desc !== "none" ? (
        <span
          className={`text-sm text-neutral-600 dark:text-neutral-300 ${
            composition.desc === "long" ? "line-clamp-3" : "line-clamp-2"
          }`}
        >
          {teaser.description.trim()}
        </span>
      ) : null}
      {composition.extra !== "none" ? (
        <span className="mt-auto flex items-center gap-2 text-xs leading-none text-neutral-500 dark:text-neutral-400">
          {composition.extra === "date_type" ? (
            <span className={contentTypeAccentClass(teaser.contentType)}>
              <ContentTypeIcon type={teaser.contentType} size={14} />
            </span>
          ) : null}
          <span>{formatItemDate(teaser.createdAt)}</span>
        </span>
      ) : null}
    </button>
  );
}
