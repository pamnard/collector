import { ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { ItemFile } from "@collector/shared";
import { resolveItemThumbnailPath } from "../../services/collector-service";
import { toDisplayAssetSrc } from "../../utils/asset-src";
import { getYouTubeThumbnail } from "../../utils/youtube-thumbnail";

interface ItemThumbnailProps {
  item: ItemFile;
  className?: string;
  /** When false, render nothing until src resolves (no placeholder). Default true. */
  showLoadingPlaceholder?: boolean;
  loadingClassName?: string;
}

export function ItemThumbnail({
  item,
  className = "h-32 w-full object-cover",
  showLoadingPlaceholder = true,
  loadingClassName = "flex h-32 w-full items-center justify-center bg-input/20 text-secondary",
}: ItemThumbnailProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSrc(null);

    void (async () => {
      const path = await resolveItemThumbnailPath(item).catch(() => null);
      if (cancelled) {
        return;
      }

      if (path) {
        setSrc(toDisplayAssetSrc(path));
        return;
      }

      if (item.url) {
        const youtube = getYouTubeThumbnail(item.url);
        if (youtube) {
          setSrc(youtube);
        }
      }
    })().finally(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [item.id, item.thumbnail, item.updated_at, item.url]);

  if (loading) {
    if (!showLoadingPlaceholder) {
      return null;
    }
    return (
      <div className={loadingClassName}>
        <ImageIcon size={20} />
      </div>
    );
  }

  if (!src) {
    return null;
  }

  return (
    <img
      src={src}
      alt=""
      className={className}
      loading="lazy"
    />
  );
}
