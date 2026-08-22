import type { ExtractedTextLink } from "./extract-text-links.js";
import {
  URL_SCHEME_RE,
  findFenceClose,
  isFenceOpener,
  skipInlineCode,
} from "./markdown-body-scan.js";
import {
  mdLinkFromBracket,
  parseMdLinkBracket,
} from "./parse-md-link-bracket.js";

function parseExternalMdLink(
  body: string,
  openIndex: number,
): { link: ExtractedTextLink | null; end: number } | null {
  const parts = parseMdLinkBracket(body, openIndex);
  if (!parts) {
    return null;
  }
  if (parts.isImage) {
    return { link: null, end: parts.end };
  }
  if (!parts.rawTarget || !URL_SCHEME_RE.test(parts.rawTarget)) {
    return { link: null, end: parts.end };
  }
  return {
    link: mdLinkFromBracket(openIndex, parts),
    end: parts.end,
  };
}

/**
 * Extract markdown `[label](https://…)` / `mailto:` links for the outbound panel (#457).
 * Does not replace {@link extractTextLinks} — vault resolve/backlinks stay unchanged.
 */
export function extractExternalMdLinks(body: string): ExtractedTextLink[] {
  const links: ExtractedTextLink[] = [];
  let i = 0;
  while (i < body.length) {
    const fence = isFenceOpener(body, i);
    if (fence) {
      i = findFenceClose(body, fence.end, fence.marker);
      continue;
    }
    if (body[i] === "`") {
      i = skipInlineCode(body, i);
      continue;
    }
    if (body[i] === "[" && body[i + 1] !== "[") {
      const parsed = parseExternalMdLink(body, i);
      if (parsed) {
        if (parsed.link) {
          links.push(parsed.link);
        }
        i = parsed.end;
        continue;
      }
    }
    if (body[i] === "!" && body[i + 1] === "[" && body[i + 2] === "[") {
      const close = body.indexOf("]]", i + 3);
      i = close === -1 ? body.length : close + 2;
      continue;
    }
    i += 1;
  }
  return links;
}
