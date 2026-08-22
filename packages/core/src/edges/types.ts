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
