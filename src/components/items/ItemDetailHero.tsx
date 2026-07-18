import { useEffect, useState } from "react";
import type { ItemFile } from "@collector/shared";
import { resolveItemThumbnailPath } from "../../services/collector-service";
import { toDisplayAssetSrc } from "../../utils/asset-src";

interface ItemDetailHeroProps {
  item: ItemFile;
}

/** Cover / first image as detail page header. Renders nothing if none. */
export function ItemDetailHero({ item }: ItemDetailHeroProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);

    void resolveItemThumbnailPath(item)
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
      <div className="mx-auto w-full max-w-[900px]">
        <img
          src={src}
          alt=""
          className="h-auto w-full rounded-lg"
        />
      </div>
    </div>
  );
}
