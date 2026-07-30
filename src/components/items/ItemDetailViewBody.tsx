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

/** View-mode main column: hero, then aside slot, then title + markdown. */
export function ItemDetailViewBody({
  item,
  content,
  aside,
  onPlayLocalVideo,
  playError,
}: ItemDetailViewBodyProps) {
  return (
    <>
      <ItemDetailHero
        item={item}
        onPlayLocalVideo={onPlayLocalVideo}
        playError={playError}
      />
      {aside}
      <header className="min-w-0 @[1100px]:col-span-9">
        <div className="mx-auto w-full max-w-[900px]">
          <h1 className="text-2xl font-semibold">{item.title}</h1>
        </div>
      </header>

      {content && (
        <section className="min-w-0 @[1100px]:col-span-9">
          <div className="mx-auto w-full max-w-[900px]">
            <MarkdownContent content={content} />
          </div>
        </section>
      )}
    </>
  );
}
