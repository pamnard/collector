import type { ExtractedTextLink } from "./extract-text-links.js";

export type MdLinkBracketParts = {
  rawTarget: string;
  displayText: string;
  end: number;
  isImage: boolean;
};

/** Parse `[label](dest)` at `openIndex`; null when syntax does not match. */
export function parseMdLinkBracket(
  body: string,
  openIndex: number,
): MdLinkBracketParts | null {
  if (body[openIndex] !== "[") {
    return null;
  }
  if (body[openIndex + 1] === "[") {
    return null;
  }
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
  let rawTarget = body.slice(urlStart, i).trim();
  if (rawTarget.startsWith("<") && rawTarget.endsWith(">")) {
    rawTarget = rawTarget.slice(1, -1).trim();
  }
  const space = rawTarget.search(/\s/);
  if (space !== -1) {
    rawTarget = rawTarget.slice(0, space).trim();
  }
  const displayText = body.slice(openIndex + 1, labelClose);
  return { rawTarget, displayText, end, isImage };
}

export function mdLinkFromBracket(
  openIndex: number,
  parts: MdLinkBracketParts,
): ExtractedTextLink {
  return {
    kind: "md",
    rawTarget: parts.rawTarget,
    displayText: parts.displayText,
    position: openIndex,
  };
}
