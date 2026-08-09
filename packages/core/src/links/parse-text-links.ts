import { extractTextLinks } from "./extract-text-links.js";
import {
  resolveTextLinks,
  type ResolvedTextLink,
  type TextLinkResolveContext,
} from "./resolve-text-links.js";

/** Extract then resolve text links from a markdown body (no frontmatter). */
export function parseAndResolveTextLinks(
  body: string,
  context: TextLinkResolveContext,
): ResolvedTextLink[] {
  return resolveTextLinks(extractTextLinks(body), context);
}
