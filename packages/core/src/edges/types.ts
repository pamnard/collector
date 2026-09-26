import type { BacklinkSource } from "../links/collect-backlink-sources.js";
import type { TextLinkResolveStatus } from "../links/resolve-text-links.js";

export type ItemEdgeSource = "text" | "user";

export type ItemEdgeKind = "wikilink" | "md" | "user";

/** Row shape for INSERT into item_edges (#407). */
export type ItemEdgeInsertRow = {
  vaultId: string;
  fromId: string;
  toId: string | null;
  rawTarget: string;
  source: ItemEdgeSource;
  kind: ItemEdgeKind;
  position: number;
  resolveStatus: TextLinkResolveStatus | null;
};

/** Same shape as {@link BacklinkSource}; user-edge neighbor in the graph (#407). */
export type UserEdgeNeighbor = BacklinkSource;

/** Parent row for wanted / missing link targets report (#595). */
export type WantedLinkResolveStatus = "unresolved" | "ambiguous";

export type WantedLinkKind = "wikilink" | "md";

export type WantedLinkTargetRow = {
  rawTarget: string;
  resolveStatus: WantedLinkResolveStatus;
  /** Representative kind when mixed; `MIN(kind)` for stability. */
  kind: WantedLinkKind;
  sourceCount: number;
};

export type WantedLinkTargetsResult = {
  total: number;
  rows: WantedLinkTargetRow[];
};

export type WantedLinkTargetSortKey = "source_count" | "raw_target";

export type WantedLinkTargetSort = {
  key: WantedLinkTargetSortKey;
  dir: "asc" | "desc";
};

export type WantedLinkSourceRow = {
  itemId: string;
  title: string;
  folderPath: string | null;
};

export type WantedLinkSourcesResult = {
  total: number;
  rows: WantedLinkSourceRow[];
};

/** Parent row for notes with broken outgoing text-links (#596). */
export type BrokenOutgoingSourceRow = {
  itemId: string;
  title: string;
  folderPath: string | null;
  brokenCount: number;
};

export type BrokenOutgoingSourcesResult = {
  total: number;
  rows: BrokenOutgoingSourceRow[];
};

export type BrokenOutgoingSourceSortKey = "broken_count" | "title";

export type BrokenOutgoingSourceSort = {
  key: BrokenOutgoingSourceSortKey;
  dir: "asc" | "desc";
};
