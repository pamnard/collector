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
    <aside className="min-w-0 @[1100px]:col-span-3">
      <div className="mx-auto w-full max-w-[900px] @[1100px]:max-w-none @[1100px]:sticky @[1100px]:top-4">
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
