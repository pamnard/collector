/**
 * Print composition model for one-item PDF export (#304).
 * Hero + title + body; gallery-only media omitted; inline media transformed.
 */

import { inferMediaType, type MediaType } from "@collector/shared";

/** One markdown image destination classified for print placement. */
export type ItemPrintInlineMedia =
  | { kind: "image"; src: string; alt: string }
  | { kind: "videoStill"; src: string; alt: string; filename: string }
  | {
      kind: "placeholder";
      mediaType: MediaType;
      filename: string;
      alt: string;
    };

export type ItemPrintBodyPart =
  | { kind: "markdown"; text: string }
  | { kind: "media"; media: ItemPrintInlineMedia };

export type ItemPrintHero = {
  /** Absolute path or data URI used as hero still (image or video cover). */
  src: string;
};

export type ItemPrintModel = {
  title: string;
  hero: ItemPrintHero | null;
  bodyParts: ItemPrintBodyPart[];
  /** Filenames referenced from the note body (for gallery-only exclusion checks). */
  referencedFilenames: string[];
};

const IMAGE_MD_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

export function filenameFromMediaSrc(src: string): string {
  let path = src.trim();
  try {
    path = new URL(path, "file:///").pathname;
  } catch {
    // keep raw
  }
  const q = path.indexOf("?");
  if (q !== -1) {
    path = path.slice(0, q);
  }
  const base = path.split("/").pop() ?? path;
  return base || "file";
}

export function classifyInlineMediaSrc(
  src: string,
  alt: string,
): ItemPrintInlineMedia {
  const filename = filenameFromMediaSrc(src);
  const mediaType = inferMediaType(filename);
  if (mediaType === "image") {
    return { kind: "image", src, alt };
  }
  if (mediaType === "video") {
    return { kind: "videoStill", src, alt, filename };
  }
  return { kind: "placeholder", mediaType, filename, alt };
}

/**
 * Split markdown body into text + inline-media parts.
 * Only destinations that appear in `![](…)` are body media; gallery-only stays out.
 */
export function splitMarkdownBodyParts(body: string): ItemPrintBodyPart[] {
  const parts: ItemPrintBodyPart[] = [];
  let lastIndex = 0;
  IMAGE_MD_RE.lastIndex = 0;
  for (const match of body.matchAll(IMAGE_MD_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ kind: "markdown", text: body.slice(lastIndex, index) });
    }
    const alt = match[1] ?? "";
    const src = match[2] ?? "";
    parts.push({ kind: "media", media: classifyInlineMediaSrc(src, alt) });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < body.length) {
    parts.push({ kind: "markdown", text: body.slice(lastIndex) });
  }
  return parts;
}

export function referencedFilenamesFromBodyParts(
  parts: readonly ItemPrintBodyPart[],
): string[] {
  const names: string[] = [];
  for (const part of parts) {
    if (part.kind !== "media") {
      continue;
    }
    if (part.media.kind === "image" || part.media.kind === "videoStill") {
      names.push(filenameFromMediaSrc(part.media.src));
    } else {
      names.push(part.media.filename);
    }
  }
  return names;
}

export function buildItemPrintModel(input: {
  title: string;
  body: string;
  heroSrc: string | null;
}): ItemPrintModel {
  const bodyParts = splitMarkdownBodyParts(input.body);
  return {
    title: input.title,
    hero: input.heroSrc ? { src: input.heroSrc } : null,
    bodyParts,
    referencedFilenames: referencedFilenamesFromBodyParts(bodyParts),
  };
}

/** Safe download basename without extension. */
export function safePdfBasename(title: string, itemId: string): string {
  const raw = title.trim() || filenameFromMediaSrc(itemId).replace(/\.md$/i, "");
  const cleaned = raw
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || "item";
}
