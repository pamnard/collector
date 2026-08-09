import type { ReactNode } from "react";
import type { ItemFile } from "@collector/shared";
import { MarkdownContent } from "../content/MarkdownContent";
import { ItemDetailHero } from "./ItemDetailHero";

type ItemDetailViewBodyProps = {
  item: ItemFile;
  content: string | null;
  aside: ReactNode;
  onPlayLocalVideo?: () => void;
  playError?: string | null;
};

/** View mode: left column (hero + title + markdown), then aside (below on narrow). */
export function ItemDetailViewBody({
  item,
  content,
  aside,
  onPlayLocalVideo,
  playError,
}: ItemDetailViewBodyProps) {
  return (
    <>
      <div className="flex min-w-0 flex-col gap-6 @[1100px]:col-span-9">
        <ItemDetailHero
          item={item}
          onPlayLocalVideo={onPlayLocalVideo}
          playError={playError}
        />
        <header className="min-w-0">
          <div className="mx-auto w-full max-w-[900px]">
            <h1 className="text-2xl font-semibold">{item.title}</h1>
          </div>
        </header>

        {content && (
          <section className="min-w-0">
            <div className="mx-auto w-full max-w-[900px]">
              <MarkdownContent itemId={item.id} content={content} />
            </div>
          </section>
        )}
      </div>
      {aside}
    </>
  );
}
