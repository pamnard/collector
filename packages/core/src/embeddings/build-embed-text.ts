import {
  EMBED_MIN_PLAIN_CHARS,
  EMBED_MIN_TITLE_CHARS,
  EMBED_SNIPPET_CHARS,
} from "./constants.js";
import type { EmbedTextResult } from "./types.js";

export type EmbedTextInput = {
  title: string;
  description: string;
  tagNames: string[];
  body?: string;
};

function joinNonEmpty(parts: string[]): string {
  return parts.filter((part) => part.length > 0).join("\n");
}

function sortedUniqueTags(tagNames: string[]): string[] {
  const cleaned = tagNames
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  return [...new Set(cleaned)].sort((a, b) => a.localeCompare(b));
}

/**
 * Strip markdown noise and take a short plain-text prefix for embedding fallback.
 */
export function extractPlainSnippet(body: string): string | null {
  let text = body.replace(/\r\n/g, "\n");
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/~~~[\s\S]*?~~~/g, " ");
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  text = text.replace(/https?:\/\/\S+/gi, " ");
  text = text.replace(/www\.\S+/gi, " ");
  text = text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        return false;
      }
      if (/^\|?[\s:-]+\|[\s|:-]*$/.test(trimmed)) {
        return false;
      }
      const pipes = (trimmed.match(/\|/g) ?? []).length;
      if (pipes >= 2) {
        return false;
      }
      return true;
    })
    .join(" ");

  text = text.replace(/\s+/g, " ").trim();
  if (text.length < EMBED_MIN_PLAIN_CHARS) {
    return null;
  }
  return text.slice(0, EMBED_SNIPPET_CHARS);
}

function modeWithoutDescription(options: {
  title: string;
  tagsJoined: string;
  snippet: string | null;
}): EmbedTextResult | null {
  const { title, tagsJoined, snippet } = options;
  const hasTags = tagsJoined.length > 0;
  const hasSnippet = snippet !== null;

  if (hasTags && hasSnippet) {
    return {
      text: joinNonEmpty([title, tagsJoined, snippet]),
      mode: "title_tags_snippet",
    };
  }
  if (hasSnippet) {
    return {
      text: joinNonEmpty([title, snippet]),
      mode: "title_snippet",
    };
  }
  if (hasTags) {
    return {
      text: joinNonEmpty([title, tagsJoined]),
      mode: "title_tags",
    };
  }
  if (title.length >= EMBED_MIN_TITLE_CHARS) {
    return { text: title, mode: "title_only" };
  }
  return null;
}

/**
 * Build embed input text with staged fallbacks (#413).
 * Returns null when there is not enough signal to embed.
 */
export function buildEmbedText(input: EmbedTextInput): EmbedTextResult | null {
  const title = input.title.trim();
  const description = input.description.trim();
  const tags = sortedUniqueTags(input.tagNames);
  const tagsJoined = tags.join(", ");
  const hasTitle = title.length >= EMBED_MIN_TITLE_CHARS;
  const hasDescription = description.length > 0;
  const hasTags = tags.length > 0;

  if (hasTitle && hasDescription && hasTags) {
    return {
      text: joinNonEmpty([title, description, tagsJoined]),
      mode: "title_desc_tags",
    };
  }

  if (hasTitle && hasDescription) {
    return {
      text: joinNonEmpty([title, description]),
      mode: "title_desc",
    };
  }

  if (hasTitle) {
    const snippet =
      input.body != null && input.body.length > 0
        ? extractPlainSnippet(input.body)
        : null;
    return modeWithoutDescription({ title, tagsJoined, snippet });
  }

  // Title is the minimum product signal for #413 (YouTube/image use title_only).
  return null;
}
