import type { ItemFile } from "@collector/shared";
import type { MediaWithPath } from "@collector/core";
import type { ArticleTocItem } from "../../lib/markdown/article-toc";
import { MediaGallery } from "../media/MediaGallery";
import { ItemDetailMetadata } from "./ItemDetailMetadata";
import { ItemDetailToc } from "./ItemDetailToc";

type ItemDetailAsideProps = {
  item: ItemFile;
  onUpdated: () => void;
  onPlayMedia: (file: MediaWithPath) => void;
  tocItems?: ArticleTocItem[];
};

export function ItemDetailAside({
  item,
  onUpdated,
  onPlayMedia,
  tocItems = [],
}: ItemDetailAsideProps) {
  return (
    <aside className="min-w-0 @[1100px]:col-span-3 @[1100px]:sticky @[1100px]:top-4 @[1100px]:max-h-[calc(100dvh-2rem)] @[1100px]:self-start @[1100px]:overflow-y-auto custom-scrollbar">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-6 pr-4 @[1100px]:max-w-none">
        {tocItems.length > 0 ? <ItemDetailToc items={tocItems} /> : null}
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
