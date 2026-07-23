import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import type { ItemFile } from "@collector/shared";
import { toDisplayAssetSrc } from "../../utils/asset-src";
import { isLocalVideoItem } from "../../utils/local-media-playback";
import { getCollectorClient } from "../../services/collector-client";

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
  const canPlayLocalVideo = Boolean(onPlayLocalVideo) && isLocalVideoItem(item);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);

    void getCollectorClient().resolveItemThumbnailPath(item)
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
    <div className="min-w-0 @[1100px]:col-span-9">
      <div className="relative mx-auto w-full max-w-[900px]">
        <img
          src={src}
          alt=""
          className="h-auto w-full rounded-lg"
        />
        {canPlayLocalVideo && (
          <button
            type="button"
            aria-label="Смотреть видео"
            onClick={onPlayLocalVideo}
            className="absolute left-1/2 top-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/65 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
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
