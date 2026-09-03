/**
 * Tag name normalization + similarity-key resolve (#943).
 *
 * Invariant: at most one catalog tag per similarity key, and every persisted
 * name (catalog + frontmatter) is the cleaned stored form — never raw input
 * like `A/B` or `Foo Bar!`.
 */
import type { Tag } from "@collector/shared";

export type NormalizedTagName = {
  /** Catalog + frontmatter name. */
  storedForm: string;
  /** Match key: storedForm with `-` and `_` removed. */
  similarityKey: string;
};

/** Normalize a raw tag name. Throws if empty after clean. */
export function normalizeTagName(raw: string): NormalizedTagName {
  let s = raw.trim().toLowerCase();
  s = s.replace(/\s+/g, " ");
  s = s.replace(/\s*-\s*/g, "-");
  s = s.replace(/[^\p{L}\p{N} \-_]/gu, "");
  s = s.replace(/ /g, "_");
  if (!s) {
    throw new Error("Tag name must be non-empty");
  }
  const similarityKey = s.replace(/[-_]/g, "");
  if (!similarityKey) {
    throw new Error("Tag name must be non-empty");
  }
  return {
    storedForm: s,
    similarityKey,
  };
}

/** Similarity key for a catalog or input name (same pipeline as normalize). */
export function tagSimilarityKey(name: string): string {
  return normalizeTagName(name).similarityKey;
}

/** Stored form for an existing catalog name (rename legacy rows onto the pipeline). */
export function tagStoredForm(name: string): string {
  return normalizeTagName(name).storedForm;
}

/**
 * Prefer earlier created_at, then smaller id.
 * Used by buildTagMaps when pre-reconcile clones share a key — provisional
 * only (no item_count on disk). Full reconcile picks by item_count first.
 */
export function preferTagForSimilarityMap(a: Tag, b: Tag): Tag {
  if (a.created_at !== b.created_at) {
    return a.created_at < b.created_at ? a : b;
  }
  return a.id < b.id ? a : b;
}

/** Resolve a raw tag name against a map keyed by similarity key. */
export function resolveTagFromMaps(
  byName: Map<string, Tag>,
  rawName: string,
): Tag | undefined {
  return byName.get(normalizeTagName(rawName).similarityKey);
}
