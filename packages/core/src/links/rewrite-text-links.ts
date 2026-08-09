import type { ResolvedTextLink } from "./resolve-text-links.js";
import { resolveTargetKey } from "./resolve-text-links.js";

export const COLLECTOR_UNRESOLVED_HREF_PREFIX = "collector-unresolved:";

/**
 * Markdown link destinations break on bare spaces (CommonMark).
 * Encode each path segment so `[label](/item/…)` stays a real link.
 */
export function itemPathHref(itemId: string): string {
  const encoded = itemId
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/item/${encoded}`;
}

/** Inverse of {@link itemPathHref} for in-app navigation. */
export function decodeItemPathHref(href: string): string {
  const prefix = "/item/";
  if (!href.startsWith(prefix)) {
    return href;
  }
  return (
    prefix +
    href
      .slice(prefix.length)
      .split("/")
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      })
      .join("/")
  );
}

export function unresolvedHref(rawTarget: string): string {
  return `${COLLECTOR_UNRESOLVED_HREF_PREFIX}${encodeURIComponent(rawTarget)}`;
}

function escapeMarkdownLinkLabel(label: string): string {
  return label.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

function linkSpanEnd(body: string, link: ResolvedTextLink): number {
  if (link.kind === "wikilink") {
    const close = body.indexOf("]]", link.position + 2);
    if (close === -1) {
      throw new Error(`Wikilink span not closed at ${link.position}`);
    }
    return close + 2;
  }

  const labelClose = body.indexOf("]", link.position + 1);
  if (labelClose === -1 || body[labelClose + 1] !== "(") {
    throw new Error(`Markdown link span invalid at ${link.position}`);
  }
  let i = labelClose + 2;
  let depth = 1;
  while (i < body.length && depth > 0) {
    const ch = body[i]!;
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        return i + 1;
      }
    }
    i += 1;
  }
  throw new Error(`Markdown link span not closed at ${link.position}`);
}

function replacementMarkdown(link: ResolvedTextLink): string {
  const labelSource =
    link.displayText ??
    (link.kind === "wikilink" ? resolveTargetKey(link.rawTarget) : link.rawTarget);
  const label = escapeMarkdownLinkLabel(labelSource || link.rawTarget);
  const href = link.resolvedItemId
    ? itemPathHref(link.resolvedItemId)
    : unresolvedHref(link.rawTarget);
  return `[${label}](${href})`;
}

/**
 * Replace extracted text links with markdown anchors for item navigation.
 * Applies replacements from the end so `position` offsets stay valid.
 */
export function rewriteTextLinksForMarkdown(
  body: string,
  links: ResolvedTextLink[],
): string {
  if (links.length === 0) {
    return body;
  }
  const ordered = [...links].sort((a, b) => b.position - a.position);
  let out = body;
  for (const link of ordered) {
    const end = linkSpanEnd(out, link);
    out =
      out.slice(0, link.position) +
      replacementMarkdown(link) +
      out.slice(end);
  }
  return out;
}
