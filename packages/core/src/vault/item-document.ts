import {
  folderPathFromItemPath,
  itemFileSchema,
  type ItemFile,
  type Tag,
} from "@collector/shared";
import {
  buildCanonicalFrontmatter,
  contentTypeFromFrontmatter,
  parseDocumentMarkdown,
  partitionDocumentFrontmatter,
  resolveFrontmatterDates,
  serializeDocumentMarkdown,
} from "./frontmatter.js";
import { basename, normalizeRelativePath } from "./paths.js";
import {
  preferTagForSimilarityMap,
  tagSimilarityKey,
  tagStoredForm,
} from "./tag-normalize.js";
import { countTextStats } from "./text-stats.js";

export interface ParseItemDocumentContext {
  itemId: string;
  vaultId: string;
  /** Similarity key → Tag (pre-reconcile collisions: earlier created_at/id only). */
  tagsByName: Map<string, Tag>;
  /**
   * When frontmatter omits created/updated, use these ISO timestamps
   * (typically derived from file mtime on first ingest).
   */
  fallbackCreatedAt?: string;
  fallbackUpdatedAt?: string;
}

export interface ParsedItemDocument {
  item: ItemFile;
  body: string;
  /** Tag names in FM that were not in tagsByName (caller must create). */
  missingTagNames: string[];
}

/** Portable fallback title: filename stem when frontmatter has no `title`. */
export function titleFromItemPath(itemRelativePath: string): string {
  const base = basename(itemRelativePath);
  return base.toLowerCase().endsWith(".md") ? base.slice(0, -3) : base;
}

export function buildTagMaps(tags: Tag[]): {
  byName: Map<string, Tag>;
  byId: Map<string, Tag>;
} {
  const byName = new Map<string, Tag>();
  const byId = new Map<string, Tag>();
  for (const tag of tags) {
    const key = tagSimilarityKey(tag.name);
    const existing = byName.get(key);
    if (existing) {
      byName.set(key, preferTagForSimilarityMap(existing, tag));
    } else {
      byName.set(key, tag);
    }
    byId.set(tag.id, tag);
  }
  return { byName, byId };
}

/**
 * Parse markdown document into ItemFile + body.
 * Does not create tags — reports missingTagNames for the caller.
 * `folder_path` is always derived from the item path (id).
 * Foreign frontmatter keys land on `item.properties`.
 */
export function parseItemDocument(
  raw: string,
  ctx: ParseItemDocumentContext,
): ParsedItemDocument {
  const itemId = normalizeRelativePath(ctx.itemId);
  const parsed = parseDocumentMarkdown(raw);
  const { known, properties } = partitionDocumentFrontmatter(parsed.frontmatter);
  const dates = resolveFrontmatterDates(known);

  const created_at = dates.created_at ?? ctx.fallbackCreatedAt;
  const updated_at = dates.updated_at ?? ctx.fallbackUpdatedAt;
  if (!created_at) {
    throw new Error(
      `Item document ${itemId} is missing created/created_at (and no fallback)`,
    );
  }
  if (!updated_at) {
    throw new Error(
      `Item document ${itemId} is missing updated/updated_at (and no fallback)`,
    );
  }

  const tagNames = known.tags ?? [];
  const tag_ids: string[] = [];
  const seenTagIds = new Set<string>();
  const missingTagNames: string[] = [];
  for (const name of tagNames) {
    const tag = ctx.tagsByName.get(tagSimilarityKey(name));
    if (!tag) {
      missingTagNames.push(name);
      continue;
    }
    if (seenTagIds.has(tag.id)) {
      continue;
    }
    seenTagIds.add(tag.id);
    tag_ids.push(tag.id);
  }

  const title = known.title ?? titleFromItemPath(itemId);
  const textStats = countTextStats(parsed.body);

  const item = itemFileSchema.parse({
    id: itemId,
    vault_id: ctx.vaultId,
    title,
    description: known.description ?? "",
    url: known.url ?? null,
    content_type: contentTypeFromFrontmatter(known) ?? "bookmark",
    source_type: known.source_type ?? "manual",
    source_id: known.source_id ?? null,
    metadata: known.metadata ?? {},
    properties,
    thumbnail: known.thumbnail ?? null,
    tag_ids,
    collection_ids: [],
    folder_path: folderPathFromItemPath(itemId),
    content_revision: known.content_revision ?? 1,
    word_count: textStats.wordCount,
    character_count: textStats.characterCount,
    created_at,
    updated_at,
  });

  return {
    item,
    body: parsed.body,
    missingTagNames,
  };
}

/**
 * Serialize ItemFile + body to canonical YAML-frontmatter markdown.
 * Fails if a tag_id has no entry in tagsById.
 * Foreign keys are written from `item.properties`.
 */
export function serializeItemDocument(
  item: ItemFile,
  body: string,
  tagsById: Map<string, Tag>,
): string {
  const tagNames: string[] = [];
  for (const tagId of item.tag_ids) {
    const tag = tagsById.get(tagId);
    if (!tag) {
      throw new Error(`Cannot serialize item ${item.id}: unknown tag_id ${tagId}`);
    }
    tagNames.push(tagStoredForm(tag.name));
  }

  const frontmatter = buildCanonicalFrontmatter({
    title: item.title,
    description: item.description,
    url: item.url,
    content_type: item.content_type,
    source_type: item.source_type,
    source_id: item.source_id,
    tags: tagNames,
    thumbnail: item.thumbnail,
    content_revision: item.content_revision,
    created: item.created_at,
    updated: item.updated_at,
    metadata: item.metadata,
    properties: item.properties,
  });

  return serializeDocumentMarkdown(frontmatter, body);
}

/** Re-parse after missing tags were created and maps refreshed. */
export function parseItemDocumentResolved(
  raw: string,
  ctx: ParseItemDocumentContext,
): { item: ItemFile; body: string } {
  const result = parseItemDocument(raw, ctx);
  if (result.missingTagNames.length > 0) {
    throw new Error(
      `Item document ${ctx.itemId} has unresolved tags: ${result.missingTagNames.join(", ")}`,
    );
  }
  return { item: result.item, body: result.body };
}
