import { COLLECTOR_UNRESOLVED_HREF_PREFIX } from "@collector/core";
import { defaultUrlTransform } from "react-markdown";

export type ItemMarkdownHrefKind = "item" | "unresolved" | "external";

export function classifyItemMarkdownHref(
  href: string | null | undefined,
): ItemMarkdownHrefKind {
  if (!href) {
    return "external";
  }
  if (href.startsWith(COLLECTOR_UNRESOLVED_HREF_PREFIX)) {
    return "unresolved";
  }
  if (href.startsWith("/item/")) {
    return "item";
  }
  return "external";
}

/**
 * react-markdown's defaultUrlTransform drops unknown schemes (href → "").
 * Keep collector item / unresolved destinations intact (#409).
 */
export function collectorMarkdownUrlTransform(url: string): string {
  if (
    url.startsWith(COLLECTOR_UNRESOLVED_HREF_PREFIX) ||
    url.startsWith("/item/")
  ) {
    return url;
  }
  return defaultUrlTransform(url);
}
