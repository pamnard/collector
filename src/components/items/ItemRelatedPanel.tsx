import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { BacklinkSource } from "@collector/api";
import type { RelatedTeaser } from "../../lib/related-teaser";
import { boardSize, spanSize } from "../../lib/teaser-layout/board";
import {
  boardGridHeightPx,
  relatedBoardGapPx,
  relatedBoardPadXPx,
} from "../../lib/teaser-layout/board-grid-geometry";
import { boardIdForContainerWidth } from "../../lib/teaser-layout/board-width";
import {
  pickTeaserLayout,
  type LayoutSlotAssignment,
} from "../../lib/teaser-layout/pick-layout";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { itemLinksPanelTabs } from "./item-links-panel-tabs";
import { RelatedTeaserSlot } from "./RelatedTeaserSlot";

type ItemRelatedPanelProps = {
  teasers: RelatedTeaser[] | null;
  backlinks: BacklinkSource[];
  onNavigate: (itemId: string) => void;
};

export function slotGridStyle(assignment: LayoutSlotAssignment): CSSProperties {
  const { w, h } = spanSize(assignment.span);
  return {
    gridColumn: `${assignment.col + 1} / span ${w}`,
    gridRow: `${assignment.row + 1} / span ${h}`,
    minHeight: 0,
    minWidth: 0,
  };
}

/** Related teasers + backlinks tabs above adjacent nav (#410 / #612). */
export function ItemRelatedPanel({
  teasers,
  backlinks,
  onNavigate,
}: ItemRelatedPanelProps) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [widthPx, setWidthPx] = useState(0);

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) {
      return;
    }
    const sync = () => {
      setWidthPx(el.getBoundingClientRect().width);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const padX = widthPx > 0 ? relatedBoardPadXPx(widthPx) : 0;
  const gapPx = widthPx > 0 ? relatedBoardGapPx(widthPx) : 0;
  const gridWidthPx = widthPx > 0 ? widthPx - padX : 0;

  const relatedList = teasers ?? [];
  const board = gridWidthPx > 0 ? boardIdForContainerWidth(gridWidthPx) : null;
  const pick = useMemo(
    () =>
      board !== null && relatedList.length > 0
        ? pickTeaserLayout(relatedList, board)
        : null,
    [relatedList, board],
  );

  const teaserById = useMemo(() => {
    const map = new Map<string, RelatedTeaser>();
    for (const teaser of relatedList) {
      map.set(teaser.id, teaser);
    }
    return map;
  }, [relatedList]);

  const size = board !== null ? boardSize(board) : null;
  const gridHeightPx =
    size !== null && gridWidthPx > 0
      ? boardGridHeightPx({
          widthPx: gridWidthPx,
          cols: size.cols,
          rows: size.rows,
          gapPx,
        })
      : null;

  const tabs = itemLinksPanelTabs({
    hasRelated: relatedList.length > 0 && pick !== null,
    backlinkCount: backlinks.length,
  });

  if (!tabs || size === null) {
    return <div ref={measureRef} className="w-full" />;
  }

  const cols = size.cols;

  return (
    <div ref={measureRef} className="w-full">
      <section
        data-testid="item-related-panel"
        data-board={pick?.board ?? board ?? undefined}
        className="border-t border-neutral-200 dark:border-neutral-700"
        aria-label="Ссылки"
      >
        <div className="px-4 py-5 md:px-8 md:py-6">
          <Tabs defaultValue={tabs.defaultTab} className="gap-3">
            <TabsList variant="line" className="mb-1">
              {tabs.showRelated ? (
                <TabsTrigger value="related">Релевантные</TabsTrigger>
              ) : null}
              {tabs.showBacklinks ? (
                <TabsTrigger value="backlinks" className="gap-1.5">
                  Обратные ссылки
                  <Badge
                    variant="secondary"
                    className="h-5 min-w-5 justify-center px-1.5 text-xs"
                  >
                    {backlinks.length}
                  </Badge>
                </TabsTrigger>
              ) : null}
            </TabsList>

            {tabs.showRelated && pick && gridHeightPx !== null ? (
              <TabsContent value="related">
                <div
                  className="grid gap-4 md:gap-8"
                  style={{
                    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${size.rows}, minmax(0, 1fr))`,
                    height: gridHeightPx,
                  }}
                >
                  {pick.slots.map((slot) => {
                    const teaser = teaserById.get(slot.teaserId);
                    if (!teaser) {
                      throw new Error(
                        `related layout slot references missing teaser: ${slot.teaserId}`,
                      );
                    }
                    return (
                      <RelatedTeaserSlot
                        key={`${slot.row}:${slot.col}:${slot.teaserId}`}
                        teaser={teaser}
                        composition={slot.composition}
                        onNavigate={onNavigate}
                        style={slotGridStyle(slot)}
                      />
                    );
                  })}
                </div>
              </TabsContent>
            ) : null}

            {tabs.showBacklinks ? (
              <TabsContent value="backlinks">
                <div
                  data-testid="item-backlinks-grid"
                  className="grid gap-4 md:gap-8"
                  style={{
                    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                  }}
                >
                  {backlinks.map((source) => (
                    <button
                      key={source.id}
                      type="button"
                      className="flex min-h-16 items-center rounded-md border border-neutral-200 px-3 py-2 text-left text-sm font-medium text-neutral-900 transition-colors hover:border-neutral-400 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:border-neutral-400 dark:hover:bg-neutral-700/40"
                      onClick={() => onNavigate(source.id)}
                    >
                      {source.title}
                    </button>
                  ))}
                </div>
              </TabsContent>
            ) : null}
          </Tabs>
        </div>
      </section>
    </div>
  );
}
