import { convertFileSrc } from "@tauri-apps/api/core";
import { ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { ItemFile } from "@collector/shared";
import { resolveItemThumbnailPath } from "../../services/collector-service";

interface ItemThumbnailProps {
  item: ItemFile;
  className?: string;
}

export function ItemThumbnail({ item, className = "h-32 w-full object-cover" }: ItemThumbnailProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void resolveItemThumbnailPath(item)
      .then((path) => {
        if (!cancelled && path) {
          setSrc(convertFileSrc(path));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSrc(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [item.id, item.thumbnail, item.updated_at]);

  if (!item.thumbnail) {
    return null;
  }

  if (!src) {
    return (
      <div className="flex h-32 w-full items-center justify-center bg-input/20 text-secondary">
        <ImageIcon size={20} />
      </div>
    );
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
