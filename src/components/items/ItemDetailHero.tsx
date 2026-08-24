import { FoldVertical, Play, UnfoldVertical } from "lucide-react";
import { useEffect, useState } from "react";
import type { ItemFile } from "@collector/shared";
import type { ItemHeroMedia } from "@collector/api";
import { useDetailHeroExpanded } from "../../hooks/useDetailHeroExpanded";
import { toDisplayAssetSrc } from "../../utils/asset-src";
import { getUiSession } from "../../services/collector-client";
import { AspectRatio } from "../ui/aspect-ratio";
import { Button } from "../ui/button";
import {
  DETAIL_HERO_ASPECT_RATIO,
  DETAIL_HERO_MEDIA_HEIGHT,
  DETAIL_HERO_MEDIA_WIDTH,
  itemDetailHeroImgClassName,
} from "./item-detail-hero-media";

interface ItemDetailHeroProps {
  item: ItemFile;
  onPlayLocalVideo?: () => void;
  playError?: string | null;
}

/** Cover / first gallery media as detail page header. Renders nothing if none. */
export function ItemDetailHero({
  item,
  onPlayLocalVideo,
  playError,
}: ItemDetailHeroProps) {
  const [hero, setHero] = useState<ItemHeroMedia | null>(null);
  const { expanded, setExpanded } = useDetailHeroExpanded();
  const canPlayLocalVideo =
    Boolean(onPlayLocalVideo) && hero?.kind === "video";
  const displaySrc =
    hero?.displayPath !== null && hero?.displayPath !== undefined
      ? toDisplayAssetSrc(hero.displayPath)
      : null;

  useEffect(() => {
    let cancelled = false;
    setHero(null);

    void getUiSession()
      .thumbnails.resolveItemHeroMedia(item)
      .catch(() => null)
      .then((media) => {
        if (cancelled || !media) {
          return;
        }
        setHero(media);
      });

    return () => {
      cancelled = true;
    };
  }, [item.id, item.thumbnail, item.updated_at]);

  if (!hero || (!displaySrc && hero.kind !== "video")) {
    return null;
  }

  return (
    <div className="min-w-0">
      <div className="group relative mx-auto w-full max-w-[900px]">
        <AspectRatio ratio={DETAIL_HERO_ASPECT_RATIO}>
          {displaySrc ? (
            <img
              src={displaySrc}
              alt=""
              width={DETAIL_HERO_MEDIA_WIDTH}
              height={DETAIL_HERO_MEDIA_HEIGHT}
              className={itemDetailHeroImgClassName(expanded)}
            />
          ) : (
            <div className="absolute inset-0 rounded-lg bg-neutral-900" />
          )}
        </AspectRatio>
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          aria-label={expanded ? "Свернуть" : "Развернуть"}
          onClick={() => setExpanded(!expanded)}
          className="absolute top-2 right-2 z-10 bg-black/55 text-white opacity-100 shadow-sm hover:bg-black/70 hover:text-white [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
        >
          {expanded ? <FoldVertical /> : <UnfoldVertical />}
        </Button>
        {canPlayLocalVideo && (
          <button
            type="button"
            aria-label="Смотреть видео"
            onClick={onPlayLocalVideo}
            className="absolute left-1/2 top-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/65 text-white shadow-lg backdrop-blur-xs transition-transform hover:scale-105 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <Play size={28} fill="currentColor" className="ml-0.5" />
          </button>
        )}
      </div>
      {playError && (
        <p className="mx-auto mt-2 max-w-[900px] text-sm text-red-400">{playError}</p>
      )}
    </div>
  );
}
