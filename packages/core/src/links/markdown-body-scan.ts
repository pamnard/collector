/** Shared markdown body scan helpers for link extractors. */

export const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export function isFenceOpener(
  body: string,
  index: number,
): { marker: string; end: number } | null {
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
  if (index > 0 && body[index - 1] !== "\n") {
    return null;
  }
  return { marker: body.slice(index, end), end };
}

export function findFenceClose(body: string, from: number, marker: string): number {
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

export function skipInlineCode(body: string, index: number): number {
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
