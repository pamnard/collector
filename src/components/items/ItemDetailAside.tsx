import type { ItemFile } from "@collector/shared";
import type { MediaWithPath } from "@collector/core";
import { MediaGallery } from "../media/MediaGallery";
import { ItemDetailMetadata } from "./ItemDetailMetadata";

type ItemDetailAsideProps = {
  item: ItemFile;
  onUpdated: () => void;
  onPlayMedia: (file: MediaWithPath) => void;
};

export function ItemDetailAside({
  item,
  onUpdated,
  onPlayMedia,
}: ItemDetailAsideProps) {
  return (
    <aside className="min-w-0 @[1100px]:col-span-3 @[1100px]:h-full">
      <div className="mx-auto w-full max-w-[900px] opacity-50 transition-opacity hover:opacity-100 @[1100px]:h-full @[1100px]:max-w-none">
        <ItemDetailMetadata item={item} />
        <MediaGallery
          itemId={item.id}
          item={item}
          onUpdated={onUpdated}
          onPlayMedia={onPlayMedia}
        />
      </div>
    </aside>
  );
}
