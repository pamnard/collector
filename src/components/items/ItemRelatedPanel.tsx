import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { BacklinkSource, OutboundTextLink } from "@collector/api";
import { itemPathHref } from "@collector/core";
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
import { cn } from "@/lib/utils";
import { ExternalAnchor } from "../content/ExternalAnchor";
import {
  ITEM_MARKDOWN_LINK_BORDER_CLASS,
  UNRESOLVED_LINK_CLASS,
} from "../content/ItemMarkdownAnchor";
import {
  itemLinksPanelTabs,
  resolveItemLinksTab,
  type ItemLinksTabId,
} from "./item-links-panel-tabs";
import {
  outboundLinkLabel,
  externalOutboundUrlHint,
  splitOutboundLinks,
} from "./item-outbound-links";
import { RelatedTeaserSlot } from "./RelatedTeaserSlot";

type ItemRelatedPanelProps = {
  teasers: RelatedTeaser[] | null;
  outbound: OutboundTextLink[];
  backlinks: BacklinkSource[];
  preferredTab: ItemLinksTabId;
  onPreferredTabChange: (tab: ItemLinksTabId) => void;
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

function OutboundLinksList({
  links,
  onNavigate,
}: {
  links: OutboundTextLink[];
  onNavigate: (itemId: string) => void;
}) {
  const { internal, external } = splitOutboundLinks(links);

  return (
    <div className="space-y-6">
      {internal.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-medium text-neutral-600 dark:text-neutral-300">
            В коллекторе
          </h3>
          <ul
            data-testid="item-outbound-internal-list"
            className="list-disc list-outside space-y-2 pl-5"
          >
            {internal.map((link) => {
              const label = outboundLinkLabel(link);
              if (link.status === "resolved" && link.resolvedItemId) {
                return (
                  <li key={link.position} className="min-w-0">
                    <a
                      href={itemPathHref(link.resolvedItemId)}
                      className={cn(
                        "inline text-base text-indigo-400 [box-decoration-break:clone]",
                        ITEM_MARKDOWN_LINK_BORDER_CLASS,
                      )}
                      onClick={(event) => {
                        event.preventDefault();
                        onNavigate(link.resolvedItemId!);
                      }}
                    >
                      {label}
                    </a>
                  </li>
                );
              }
              return (
                <li key={link.position} className="min-w-0">
                  <span
                    className={cn(
                      "inline text-base [box-decoration-break:clone]",
                      UNRESOLVED_LINK_CLASS,
                    )}
                  >
                    {label}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {external.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-medium text-neutral-600 dark:text-neutral-300">
            В интернет
          </h3>
          <ul
            data-testid="item-outbound-external-list"
            className="list-disc list-outside space-y-2 pl-5"
          >
            {external.map((link) => {
              const label = outboundLinkLabel(link);
              const urlHint = externalOutboundUrlHint(link);
              return (
                <li key={link.position} className="min-w-0">
                  <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <ExternalAnchor
                      href={link.rawTarget}
                      className={cn(
                        "inline text-base text-indigo-400 [box-decoration-break:clone]",
                        ITEM_MARKDOWN_LINK_BORDER_CLASS,
                      )}
                    >
                      {label}
                    </ExternalAnchor>
                    {urlHint ? (
                      <>
                        <span
                          className="text-sm text-neutral-500 dark:text-neutral-400"
                          aria-hidden="true"
                        >
                          -
                        </span>
                        <span className="text-sm text-neutral-500 break-all dark:text-neutral-400">
                          {urlHint}
                        </span>
                      </>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Related teasers + outgoing/backlinks tabs above adjacent nav (#410 / #457). */
export function ItemRelatedPanel({
  teasers,
  outbound,
  backlinks,
  preferredTab,
  onPreferredTabChange,
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
    outgoingCount: outbound.length,
    backlinkCount: backlinks.length,
  });

  if (!tabs) {
    return <div ref={measureRef} className="w-full" />;
  }
  if (tabs.showRelated && size === null) {
    return <div ref={measureRef} className="w-full" />;
  }

  const cols = size?.cols ?? 1;
  const tabValue = resolveItemLinksTab(preferredTab, tabs);
  const isItemLinksTab = (value: string): value is ItemLinksTabId =>
    value === "related" || value === "outgoing" || value === "backlinks";

  return (
    <div ref={measureRef} className="w-full">
      <section
        data-testid="item-related-panel"
        data-board={pick?.board ?? board ?? undefined}
        className="border-t border-neutral-200 dark:border-neutral-700"
        aria-label="Ссылки"
      >
        <div className="px-4 py-5 md:px-8 md:py-6">
          <Tabs
            value={tabValue}
            onValueChange={(value) => {
              if (isItemLinksTab(value)) {
                onPreferredTabChange(value);
              }
            }}
            className="gap-3"
          >
            <TabsList className="mb-1">
              {tabs.showRelated ? (
                <TabsTrigger value="related">Релевантные</TabsTrigger>
              ) : null}
              {tabs.showOutgoing ? (
                <TabsTrigger value="outgoing" className="gap-1.5">
                  Исходящие
                  <Badge
                    variant="secondary"
                    className="h-5 min-w-5 justify-center px-1.5 text-xs"
                  >
                    {outbound.length}
                  </Badge>
                </TabsTrigger>
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

            {tabs.showRelated && pick && size !== null && gridHeightPx !== null ? (
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

            {tabs.showOutgoing ? (
              <TabsContent value="outgoing">
                <OutboundLinksList links={outbound} onNavigate={onNavigate} />
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
              </TabsContent>
            ) : null}
          </Tabs>
        </div>
      </section>
    </div>
  );
}
