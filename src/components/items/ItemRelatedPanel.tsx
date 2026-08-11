import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { RelatedTeaser } from "../../lib/related-teaser";
import { boardSize, spanSize } from "../../lib/teaser-layout/board";
import { boardIdForContainerWidth } from "../../lib/teaser-layout/board-width";
import {
  pickTeaserLayout,
  type LayoutSlotAssignment,
} from "../../lib/teaser-layout/pick-layout";
import { RelatedTeaserSlot } from "./RelatedTeaserSlot";

type ItemRelatedPanelProps = {
  teasers: RelatedTeaser[];
  onNavigate: (itemId: string) => void;
};

export function slotGridStyle(assignment: LayoutSlotAssignment): CSSProperties {
  const { w, h } = spanSize(assignment.span);
  return {
    gridColumn: `${assignment.col + 1} / span ${w}`,
    gridRow: `${assignment.row + 1} / span ${h}`,
  };
}

/** Related teasers above adjacent nav — layout from pickTeaserLayout (#612). */
export function ItemRelatedPanel({
  teasers,
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

  // Re-pick only when board family changes (900/620 thresholds), not every pixel.
  const board = widthPx > 0 ? boardIdForContainerWidth(widthPx) : null;
  const pick = useMemo(
    () => (board !== null ? pickTeaserLayout(teasers, board) : null),
    [teasers, board],
  );

  const teaserById = useMemo(() => {
    const map = new Map<string, RelatedTeaser>();
    for (const teaser of teasers) {
      map.set(teaser.id, teaser);
    }
    return map;
  }, [teasers]);

  const cols = board !== null ? boardSize(board).cols : 0;

  return (
    <div ref={measureRef} className="w-full">
      {pick ? (
        <section
          data-testid="item-related-panel"
          data-board={pick.board}
          className="border-t border-neutral-200 dark:border-neutral-700"
          aria-label="Релевантные"
        >
          <div className="px-4 py-5 md:px-8 md:py-6">
            <h2 className="mb-3 text-sm font-medium">Релевантные</h2>
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                gridAutoRows: "minmax(7rem, auto)",
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
          </div>
        </section>
      ) : null}
    </div>
  );
}
