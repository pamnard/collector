import { extractExternalMdLinks } from "./extract-external-md-links.js";
import { parseAndResolveTextLinks } from "./parse-text-links.js";
import type { TextLinkResolveStatus } from "./resolve-text-links.js";
import { textLinkResolveContextFromItems } from "./text-links-reindex.js";

export type OutboundLinkScope = "internal" | "external";

export type OutboundTextLink = {
  scope: OutboundLinkScope;
  kind: "wikilink" | "md";
  rawTarget: string;
  displayText: string | null;
  position: number;
  resolvedItemId: string | null;
  status: TextLinkResolveStatus | null;
  title: string | null;
};

/** Stable identity for outbound panel rows (#457, mirrors backlink source dedup). */
export function outboundLinkDedupKey(link: OutboundTextLink): string {
  if (link.scope === "external") {
    return `external:${link.rawTarget}\0${link.displayText ?? ""}`;
  }
  if (link.resolvedItemId !== null) {
    return `internal:resolved:${link.resolvedItemId}`;
  }
  return `internal:${link.kind}:${link.rawTarget}\0${link.displayText ?? ""}`;
}

/** Keep first body occurrence per {@link outboundLinkDedupKey}. */
export function dedupeOutboundLinks(
  links: readonly OutboundTextLink[],
): OutboundTextLink[] {
  const seen = new Set<string>();
  const out: OutboundTextLink[] = [];
  for (const link of links) {
    const key = outboundLinkDedupKey(link);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(link);
  }
  return out;
}

/**
 * Ordered outbound links from one note body (#457).
 * Internal via vault parse+resolve; external via {@link extractExternalMdLinks}.
 */
export function collectOutboundLinks(
  sourceItemId: string,
  body: string,
  catalog: ReadonlyArray<{ id: string; title: string }>,
): OutboundTextLink[] {
  const context = textLinkResolveContextFromItems(sourceItemId, catalog);
  const titleById = new Map(catalog.map((entry) => [entry.id, entry.title]));

  const internal = parseAndResolveTextLinks(body, context).map(
    (link): OutboundTextLink => ({
      scope: "internal",
      kind: link.kind,
      rawTarget: link.rawTarget,
      displayText: link.displayText,
      position: link.position,
      resolvedItemId: link.resolvedItemId,
      status: link.resolveStatus,
      title:
        link.resolvedItemId === null
          ? null
          : (titleById.get(link.resolvedItemId) ?? null),
    }),
  );

  const external = extractExternalMdLinks(body).map(
    (link): OutboundTextLink => ({
      scope: "external",
      kind: link.kind,
      rawTarget: link.rawTarget,
      displayText: link.displayText,
      position: link.position,
      resolvedItemId: null,
      status: null,
      title: null,
    }),
  );

  return dedupeOutboundLinks(
    [...internal, ...external].sort((a, b) => a.position - b.position),
  );
}
