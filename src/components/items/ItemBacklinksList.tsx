import type { BacklinkSource } from "@collector/api";
import { itemPathHref } from "@collector/core";
import { cn } from "@/lib/utils";
import { ITEM_MARKDOWN_LINK_BORDER_CLASS } from "../content/ItemMarkdownAnchor";

type ItemBacklinksListProps = {
  backlinks: BacklinkSource[];
  cols: number;
  onNavigate: (itemId: string) => void;
};

export function ItemBacklinksList({
  backlinks,
  cols,
  onNavigate,
}: ItemBacklinksListProps) {
  return (
    <div
      data-testid="item-backlinks-grid"
      className="grid gap-4 md:gap-8"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      }}
    >
      {backlinks.map((source) => (
        <div key={source.id} className="min-w-0">
          <a
            href={itemPathHref(source.id)}
            className={cn(
              "inline text-base text-indigo-400 [box-decoration-break:clone]",
              ITEM_MARKDOWN_LINK_BORDER_CLASS,
            )}
            onClick={(event) => {
              event.preventDefault();
              onNavigate(source.id);
            }}
          >
            {source.title}
          </a>
        </div>
      ))}
    </div>
  );
}
