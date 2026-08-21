import { ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { ItemFile } from "@collector/shared";
import { resolveCoverSrc } from "../../utils/item-cover-src";
import { getUiSession } from "../../services/collector-client";

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
  loadingClassName = "flex h-32 w-full items-center justify-center bg-neutral-100/20 dark:bg-neutral-700/20 text-neutral-500 dark:text-neutral-400",
}: ItemThumbnailProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSrc(null);

    void (async () => {
      const path = await getUiSession()
        .thumbnails.resolveItemThumbnailPath(item)
        .catch(() => null);
      if (cancelled) {
        return;
      }

      const cover = resolveCoverSrc(path);
      if (cover) {
        setSrc(cover);
      }
    })().finally(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [item.id, item.thumbnail, item.updated_at]);

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
