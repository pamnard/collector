import type { OutboundTextLink } from "@collector/api";

export function splitOutboundLinks(links: OutboundTextLink[]): {
  internal: OutboundTextLink[];
  external: OutboundTextLink[];
} {
  const internal: OutboundTextLink[] = [];
  const external: OutboundTextLink[] = [];
  for (const link of links) {
    if (link.scope === "internal") {
      internal.push(link);
    } else {
      external.push(link);
    }
  }
  return { internal, external };
}

export function outboundLinkLabel(link: OutboundTextLink): string {
  if (
    link.scope === "internal" &&
    link.status === "resolved" &&
    link.title &&
    link.title.trim()
  ) {
    return link.title.trim();
  }
  const alias = link.displayText?.trim();
  if (alias) {
    return alias;
  }
  return link.rawTarget;
}

/** External md link with its own label — show raw URL beside the clickable text (#457). */
export function externalOutboundUrlHint(link: OutboundTextLink): string | null {
  if (link.scope !== "external") {
    return null;
  }
  const alias = link.displayText?.trim();
  if (!alias || alias === link.rawTarget) {
    return null;
  }
  return link.rawTarget;
}
