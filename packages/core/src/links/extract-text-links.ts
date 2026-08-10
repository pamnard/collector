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

const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function isFenceOpener(body: string, index: number): { marker: string; end: number } | null {
  const ch = body[index];
  if (ch !== "`" && ch !== "~") {
    return null;
  }
  let end = index;
  while (end < body.length && body[end] === ch) {
    end += 1;
  }
  const len = end - index;
  if (len < 3) {
    return null;
  }
  // Fence must start at line beginning (or start of body).
  if (index > 0 && body[index - 1] !== "\n") {
    return null;
  }
  return { marker: body.slice(index, end), end };
}

function findFenceClose(body: string, from: number, marker: string): number {
  let i = from;
  while (i < body.length) {
    const nl = body.indexOf("\n", i);
    const lineStart = nl === -1 ? body.length : nl + 1;
    if (lineStart >= body.length) {
      return body.length;
    }
    if (body.startsWith(marker, lineStart)) {
      let j = lineStart + marker.length;
      while (j < body.length && body[j] === marker[0]) {
        j += 1;
      }
      // Rest of closing fence line may have trailing spaces only.
      let k = j;
      while (k < body.length && (body[k] === " " || body[k] === "\t")) {
        k += 1;
      }
      if (k >= body.length || body[k] === "\n") {
        return k < body.length ? k + 1 : k;
      }
    }
    i = lineStart;
  }
  return body.length;
}

function skipInlineCode(body: string, index: number): number {
  // index points at opening `
  let ticks = 0;
  while (index + ticks < body.length && body[index + ticks] === "`") {
    ticks += 1;
  }
  if (ticks === 0) {
    return index + 1;
  }
  const opener = body.slice(index, index + ticks);
  const closeAt = body.indexOf(opener, index + ticks);
  if (closeAt === -1) {
    return body.length;
  }
  return closeAt + ticks;
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
  // openIndex at `[` of `[label](url)`
  if (body[openIndex] !== "[") {
    return null;
  }
  // Not a wikilink opener.
  if (body[openIndex + 1] === "[") {
    return null;
  }
  // Image `![alt](url)` is not a navigable text link (#590 regression via #409).
  const isImage = openIndex > 0 && body[openIndex - 1] === "!";
  const labelClose = body.indexOf("]", openIndex + 1);
  if (labelClose === -1) {
    return null;
  }
  if (body[labelClose + 1] !== "(") {
    return null;
  }
  const urlStart = labelClose + 2;
  let i = urlStart;
  let depth = 1;
  while (i < body.length && depth > 0) {
    const ch = body[i]!;
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        break;
      }
    } else if (ch === "\n") {
      return null;
    }
    i += 1;
  }
  if (depth !== 0) {
    return null;
  }
  const end = i + 1;
  if (isImage) {
    return { link: null, end };
  }
  let target = body.slice(urlStart, i).trim();
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1).trim();
  }
  // Destination may include title: url "title" — take first token.
  const space = target.search(/\s/);
  if (space !== -1) {
    target = target.slice(0, space).trim();
  }
  // Recognized markdown link, but not a vault item target.
  if (!target || URL_SCHEME_RE.test(target)) {
    return { link: null, end };
  }

  const displayText = body.slice(openIndex + 1, labelClose);
  return {
    link: {
      kind: "md",
      rawTarget: target,
      displayText,
      position: openIndex,
    },
    end,
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
