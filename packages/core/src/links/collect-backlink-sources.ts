import { parseAndResolveTextLinks } from "./parse-text-links.js";
import {
  textLinkCatalogIndexesFromItems,
  textLinkResolveContextFromIndexes,
  type TextLinkCatalogIndexes,
} from "./text-links-reindex.js";

export type BacklinkSource = {
  id: string;
  title: string;
};

export type BacklinkSourceBody = BacklinkSource & {
  body: string;
};

function parseResolvedLinks(
  source: BacklinkSourceBody,
  indexes: TextLinkCatalogIndexes,
) {
  return parseAndResolveTextLinks(
    source.body,
    textLinkResolveContextFromIndexes(source.id, indexes),
  );
}

/**
 * Collect unique items that contain at least one resolved text-link to
 * `targetItemId`. Self-links and unresolved targets are ignored (#410).
 */
export function collectBacklinkSources(
  targetItemId: string,
  catalog: ReadonlyArray<BacklinkSource>,
  sources: ReadonlyArray<BacklinkSourceBody>,
): BacklinkSource[] {
  const out: BacklinkSource[] = [];
  const seen = new Set<string>();
  const indexes = textLinkCatalogIndexesFromItems(catalog);

  for (const source of sources) {
    if (source.id === targetItemId) {
      continue;
    }
    const hitsTarget = parseResolvedLinks(source, indexes).some(
      (link) => link.resolvedItemId === targetItemId,
    );
    if (!hitsTarget || seen.has(source.id)) {
      continue;
    }
    seen.add(source.id);
    out.push({ id: source.id, title: source.title });
  }

  return out;
}

/**
 * Build target → unique sources for an entire vault snapshot (#410).
 * Used by the host in-memory reverse map.
 */
export function buildBacklinkReverseMap(
  catalog: ReadonlyArray<BacklinkSource>,
  sources: ReadonlyArray<BacklinkSourceBody>,
): Map<string, BacklinkSource[]> {
  const reverse = new Map<string, BacklinkSource[]>();
  const seenByTarget = new Map<string, Set<string>>();
  const indexes = textLinkCatalogIndexesFromItems(catalog);

  for (const source of sources) {
    for (const link of parseResolvedLinks(source, indexes)) {
      const targetId = link.resolvedItemId;
      if (targetId === null || targetId === source.id) {
        continue;
      }
      let seen = seenByTarget.get(targetId);
      if (!seen) {
        seen = new Set();
        seenByTarget.set(targetId, seen);
      }
      if (seen.has(source.id)) {
        continue;
      }
      seen.add(source.id);
      let list = reverse.get(targetId);
      if (!list) {
        list = [];
        reverse.set(targetId, list);
      }
      list.push({ id: source.id, title: source.title });
    }
  }

  return reverse;
}
