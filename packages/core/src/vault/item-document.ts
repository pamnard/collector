import {
  itemFileSchema,
  type ItemFile,
  type Tag,
} from "@collector/shared";
import {
  buildCanonicalFrontmatter,
  contentTypeFromFrontmatter,
  extractUnknownFrontmatterKeys,
  parseDocumentMarkdown,
  parseKnownFrontmatter,
  resolveFrontmatterDates,
  serializeDocumentMarkdown,
} from "./frontmatter.js";

export interface ParseItemDocumentContext {
  itemId: string;
  vaultId: string;
  /** Lowercased tag name → Tag */
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
  /** Portable unknown FM keys to preserve on rewrite. */
  extra: Record<string, unknown>;
}

function tagNameKey(name: string): string {
  return name.toLowerCase();
}

export function buildTagMaps(tags: Tag[]): {
  byName: Map<string, Tag>;
  byId: Map<string, Tag>;
} {
  const byName = new Map<string, Tag>();
  const byId = new Map<string, Tag>();
  for (const tag of tags) {
    byName.set(tagNameKey(tag.name), tag);
    byId.set(tag.id, tag);
  }
  return { byName, byId };
}

/**
 * Parse markdown document into ItemFile + body.
 * Does not create tags — reports missingTagNames for the caller.
 */
export function parseItemDocument(
  raw: string,
  ctx: ParseItemDocumentContext,
): ParsedItemDocument {
  const parsed = parseDocumentMarkdown(raw);
  const known = parseKnownFrontmatter(parsed.frontmatter);
  const extra = extractUnknownFrontmatterKeys(parsed.frontmatter);
  const dates = resolveFrontmatterDates(known);

  const created_at = dates.created_at ?? ctx.fallbackCreatedAt;
  const updated_at = dates.updated_at ?? ctx.fallbackUpdatedAt;
  if (!created_at) {
    throw new Error(
      `Item document ${ctx.itemId} is missing created/created_at (and no fallback)`,
    );
  }
  if (!updated_at) {
    throw new Error(
      `Item document ${ctx.itemId} is missing updated/updated_at (and no fallback)`,
    );
  }

  const tagNames = known.tags ?? [];
  const tag_ids: string[] = [];
  const missingTagNames: string[] = [];
  for (const name of tagNames) {
    const tag = ctx.tagsByName.get(tagNameKey(name));
    if (!tag) {
      missingTagNames.push(name);
      continue;
    }
    tag_ids.push(tag.id);
  }

  const title = known.title;
  if (!title) {
    throw new Error(`Item document ${ctx.itemId} is missing title in frontmatter`);
  }

  const item = itemFileSchema.parse({
    id: ctx.itemId,
    vault_id: ctx.vaultId,
    title,
    description: known.description ?? "",
    url: known.url ?? null,
    content_type: contentTypeFromFrontmatter(known) ?? "bookmark",
    source_type: known.source_type ?? "manual",
    source_id: known.source_id ?? null,
    metadata: known.metadata ?? {},
    thumbnail: known.thumbnail ?? null,
    is_archived: known.is_archived ?? false,
    is_favorite: known.is_favorite ?? false,
    tag_ids,
    collection_ids: known.collection_ids ?? [],
    folder_path: known.folder_path ?? "",
    content_revision: known.content_revision ?? 1,
    created_at,
    updated_at,
  });

  return {
    item,
    body: parsed.body,
    missingTagNames,
    extra,
  };
}

/**
 * Serialize ItemFile + body to canonical YAML-frontmatter markdown.
 * Fails if a tag_id has no entry in tagsById.
 */
export function serializeItemDocument(
  item: ItemFile,
  body: string,
  tagsById: Map<string, Tag>,
  extra?: Record<string, unknown>,
): string {
  const tagNames: string[] = [];
  for (const tagId of item.tag_ids) {
    const tag = tagsById.get(tagId);
    if (!tag) {
      throw new Error(`Cannot serialize item ${item.id}: unknown tag_id ${tagId}`);
    }
    tagNames.push(tag.name);
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
    is_archived: item.is_archived,
    is_favorite: item.is_favorite,
    folder_path: item.folder_path,
    collection_ids: item.collection_ids,
    content_revision: item.content_revision,
    created: item.created_at,
    updated: item.updated_at,
    metadata: item.metadata,
    extra,
  });

  return serializeDocumentMarkdown(frontmatter, body);
}

/** Re-parse after missing tags were created and maps refreshed. */
export function parseItemDocumentResolved(
  raw: string,
  ctx: ParseItemDocumentContext,
): { item: ItemFile; body: string; extra: Record<string, unknown> } {
  const result = parseItemDocument(raw, ctx);
  if (result.missingTagNames.length > 0) {
    throw new Error(
      `Item document ${ctx.itemId} has unresolved tags: ${result.missingTagNames.join(", ")}`,
    );
  }
  return { item: result.item, body: result.body, extra: result.extra };
}
