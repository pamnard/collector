import { ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { ItemFile } from "@collector/shared";
import { imageDisplaySlotById } from "../../lib/image-slot-fit";
import { getUiSession } from "../../services/collector-client";
import {
  buildDerivedImageAttrs,
  type DerivedImageAttrs,
} from "../../utils/derived-image-src";

interface ItemThumbnailProps {
  item: ItemFile;
  className?: string;
  /** When false, render nothing until src resolves (no placeholder). Default true. */
  showLoadingPlaceholder?: boolean;
  loadingClassName?: string;
}

const THUMBNAIL_SLOT_CSS_WIDTH_PX =
  imageDisplaySlotById("thumbnail").cssWidthPx;

export function ItemThumbnail({
  item,
  className = "h-32 w-full object-cover",
  showLoadingPlaceholder = true,
  loadingClassName = "flex h-32 w-full items-center justify-center bg-neutral-100/20 dark:bg-neutral-700/20 text-neutral-500 dark:text-neutral-400",
}: ItemThumbnailProps) {
  const [attrs, setAttrs] = useState<DerivedImageAttrs | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setAttrs(null);

    void (async () => {
      const path = await getUiSession()
        .thumbnails.resolveItemThumbnailPath(item)
        .catch(() => null);
      if (cancelled) {
        return;
      }

      if (path) {
        setAttrs(
          buildDerivedImageAttrs({
            displayPath: path,
            slotCssWidthPx: THUMBNAIL_SLOT_CSS_WIDTH_PX,
          }),
        );
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

  if (!attrs?.src) {
    return null;
  }

  return (
    <img
      src={attrs.src}
      srcSet={attrs.srcSet}
      sizes={attrs.sizes}
      alt=""
      className={className}
      loading="lazy"
    />
  );
}
