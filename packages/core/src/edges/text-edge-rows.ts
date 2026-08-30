import { parseAndResolveTextLinks } from "../links/parse-text-links.js";
import {
  textLinkResolveContextFromIndexes,
  type TextLinkCatalogIndexes,
} from "../links/text-links-reindex.js";
import type { ItemEdgeInsertRow } from "./types.js";

function textEdgeDedupKey(row: Pick<ItemEdgeInsertRow, "toId" | "kind" | "rawTarget" | "position">): string {
  if (row.toId !== null) {
    return `resolved:${row.toId}`;
  }
  return `${row.kind}:${row.rawTarget}\0${row.position}`;
}

/**
 * Internal text-link rows for one note body (#407).
 * Skips self-links; stores resolved, unresolved, and ambiguous targets.
 * Callers that process many notes should build indexes once (#920).
 */
export function textEdgeRowsFromBody(
  vaultId: string,
  fromId: string,
  body: string,
  indexes: TextLinkCatalogIndexes,
): ItemEdgeInsertRow[] {
  const context = textLinkResolveContextFromIndexes(fromId, indexes);
  const links = parseAndResolveTextLinks(body, context);
  const seen = new Set<string>();
  const rows: ItemEdgeInsertRow[] = [];

  for (const link of links) {
    if (link.resolvedItemId === fromId) {
      continue;
    }
    const row: ItemEdgeInsertRow = {
      vaultId,
      fromId,
      toId: link.resolvedItemId,
      rawTarget: link.rawTarget,
      source: "text",
      kind: link.kind,
      position: link.position,
      resolveStatus: link.resolveStatus,
    };
    const key = textEdgeDedupKey(row);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    rows.push(row);
  }

  return rows;
}
