import { FoldVertical, Play, UnfoldVertical } from "lucide-react";
import { useEffect, useState } from "react";
import type { ItemFile } from "@collector/shared";
import { useDetailHeroExpanded } from "../../hooks/useDetailHeroExpanded";
import { toDisplayAssetSrc } from "../../utils/asset-src";
import { isLocalVideoItem } from "../../utils/local-media-playback";
import { getUiSession } from "../../services/collector-client";
import { AspectRatio } from "../ui/aspect-ratio";
import { Button } from "../ui/button";

interface ItemDetailHeroProps {
  item: ItemFile;
  onPlayLocalVideo?: () => void;
  playError?: string | null;
}

/** Cover / first image as detail page header. Renders nothing if none. */
export function ItemDetailHero({
  item,
  onPlayLocalVideo,
  playError,
}: ItemDetailHeroProps) {
  const [src, setSrc] = useState<string | null>(null);
  const { expanded, setExpanded } = useDetailHeroExpanded();
  const canPlayLocalVideo = Boolean(onPlayLocalVideo) && isLocalVideoItem(item);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);

    void getUiSession()
      .thumbnails.resolveItemThumbnailPath(item)
      .catch(() => null)
      .then((path) => {
        if (cancelled || !path) {
          return;
        }
        setSrc(toDisplayAssetSrc(path));
      });

    return () => {
      cancelled = true;
    };
  }, [item.id, item.thumbnail, item.updated_at]);

  if (!src) {
    return null;
  }

  return (
    <div className="min-w-0">
      <div className="group relative mx-auto w-full max-w-[900px]">
        {expanded ? (
          <img src={src} alt="" className="h-auto w-full rounded-lg" />
        ) : (
          <AspectRatio ratio={16 / 9}>
            <img
              src={src}
              alt=""
              className="absolute inset-0 h-full w-full rounded-lg object-cover"
            />
          </AspectRatio>
        )}
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
