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

export type TextLinkKind = "wikilink" | "md";

export interface ExtractedTextLink {
  kind: TextLinkKind;
  /** Target as written (path, title, or with #heading / ^block). */
  rawTarget: string;
  /** Alias / link label when present; otherwise null. */
  displayText: string | null;
  /** UTF-16 offset of the link start in the markdown body. */
  position: number;
}

function parseWikilink(
  body: string,
  openIndex: number,
): { link: ExtractedTextLink; end: number } | null {
  // openIndex at first `[` of `[[`
  if (body[openIndex] !== "[" || body[openIndex + 1] !== "[") {
    return null;
  }
  if (openIndex > 0 && body[openIndex - 1] === "!") {
    return null;
  }
  const innerStart = openIndex + 2;
  const close = body.indexOf("]]", innerStart);
  if (close === -1) {
    return null;
  }
  const inner = body.slice(innerStart, close);
  if (!inner.trim()) {
    return null;
  }
  const pipe = inner.indexOf("|");
  const rawTarget = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
  const displayText =
    pipe === -1 ? null : inner.slice(pipe + 1).trim() || null;
  if (!rawTarget) {
    return null;
  }
  return {
    link: {
      kind: "wikilink",
      rawTarget,
      displayText,
      position: openIndex,
    },
    end: close + 2,
  };
}

function parseMdLink(
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
  if (!parts.rawTarget || URL_SCHEME_RE.test(parts.rawTarget)) {
    return { link: null, end: parts.end };
  }
  return {
    link: mdLinkFromBracket(openIndex, parts),
    end: parts.end,
  };
}

/**
 * Extract `[[wikilink]]` and vault-relative markdown links from a note body.
 * Skips fenced/inline code, `![[embed]]`, and `![image](url)` (#590).
 * Does not resolve targets.
 */
export function extractTextLinks(body: string): ExtractedTextLink[] {
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
    if (body[i] === "[" && body[i + 1] === "[") {
      const parsed = parseWikilink(body, i);
      if (parsed) {
        links.push(parsed.link);
        i = parsed.end;
        continue;
      }
    }
    if (body[i] === "[") {
      const parsed = parseMdLink(body, i);
      if (parsed) {
        if (parsed.link) {
          links.push(parsed.link);
        }
        i = parsed.end;
        continue;
      }
    }
    // Skip embed: ![[...]]
    if (body[i] === "!" && body[i + 1] === "[" && body[i + 2] === "[") {
      const close = body.indexOf("]]", i + 3);
      i = close === -1 ? body.length : close + 2;
      continue;
    }
    i += 1;
  }
  return links;
}
