import {
  itemFileSchema,
  sourceRefSchema,
  vaultMetaSchema,
  type ItemFile,
  type SourceRef,
  type VaultMeta,
} from "@collector/shared";
import type { FileSystemAdapter } from "../adapters/types.js";
import {
  buildCanonicalFrontmatter,
  contentTypeFromFrontmatter,
  parseDocumentMarkdown,
  parseKnownFrontmatter,
  resolveFrontmatterDates,
  serializeDocumentMarkdown,
} from "./frontmatter.js";
import {
  basename,
  dirname,
  folderPathFromItemId,
  itemMarkdownPath,
  itemMediaRoot,
  itemSourcePath,
  joinSegments,
  normalizeRelativePath,
  vaultMetaPath,
} from "./paths.js";

export async function readVaultMeta(
  fs: FileSystemAdapter,
  vaultRootPath: string,
): Promise<VaultMeta> {
  const raw = await fs.readText(vaultMetaPath(vaultRootPath));
  return vaultMetaSchema.parse(JSON.parse(raw));
}

export async function writeVaultMeta(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  meta: VaultMeta,
): Promise<void> {
  const parsed = vaultMetaSchema.parse(meta);
  await fs.writeText(vaultMetaPath(vaultRootPath), JSON.stringify(parsed, null, 2));
}

function isoFromMtime(mtimeMs: number | null): string | undefined {
  return mtimeMs === null ? undefined : new Date(mtimeMs).toISOString();
}

/** Portable fallback title: filename stem when frontmatter has no `title`. */
function titleFromPath(itemRelativePath: string): string {
  const base = basename(itemRelativePath);
  return base.toLowerCase().endsWith(".md") ? base.slice(0, -3) : base;
}

/**
 * Assemble an {@link ItemFile} from a markdown document. Dates come from
 * frontmatter first, falling back to the file's mtime (FS stat). `vault_id`
 * and `folder_path` are injected from context / the item path.
 */
export async function assembleItemFileFromMarkdown(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  itemRelativePath: string,
  vaultId: string,
  markdown: string,
): Promise<ItemFile> {
  const id = normalizeRelativePath(itemRelativePath);
  const parsed = parseDocumentMarkdown(markdown);
  const fm = parseKnownFrontmatter(parsed.frontmatter);
  const dates = resolveFrontmatterDates(fm);

  let createdAt = dates.created_at;
  let updatedAt = dates.updated_at;
  if (!createdAt || !updatedAt) {
    const stat = await fs.stat(itemMarkdownPath(vaultRootPath, id));
    const iso = isoFromMtime(stat.mtimeMs);
    if (!iso) {
      throw new Error(`Cannot resolve created/updated dates for item ${id}`);
    }
    createdAt = createdAt ?? iso;
    updatedAt = updatedAt ?? iso;
  }

  return itemFileSchema.parse({
    id,
    vault_id: vaultId,
    title: fm.title ?? titleFromPath(id),
    description: fm.description,
    url: fm.url ?? null,
    content_type: contentTypeFromFrontmatter(fm),
    source_type: fm.source_type,
    source_id: fm.source_id ?? null,
    metadata: fm.metadata,
    thumbnail: fm.thumbnail ?? null,
    tags: fm.tags,
    folder_path: folderPathFromItemId(id),
    content_revision: fm.content_revision,
    created_at: createdAt,
    updated_at: updatedAt,
  });
}

export async function readItemFile(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  itemRelativePath: string,
  vaultId: string,
): Promise<ItemFile> {
  const raw = await fs.readText(itemMarkdownPath(vaultRootPath, itemRelativePath));
  return assembleItemFileFromMarkdown(
    fs,
    vaultRootPath,
    itemRelativePath,
    vaultId,
    raw,
  );
}

/** Markdown body (content) of an item document, or null when absent on disk. */
export async function readItemContent(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  itemRelativePath: string,
): Promise<string | null> {
  const path = itemMarkdownPath(vaultRootPath, itemRelativePath);
  if (!(await fs.exists(path))) {
    return null;
  }
  const raw = await fs.readText(path);
  return parseDocumentMarkdown(raw).body;
}

function itemToFrontmatter(item: ItemFile): Record<string, unknown> {
  return buildCanonicalFrontmatter({
    title: item.title,
    description: item.description || undefined,
    url: item.url ?? undefined,
    content_type: item.content_type,
    source_type: item.source_type,
    source_id: item.source_id ?? undefined,
    tags: item.tags,
    thumbnail: item.thumbnail ?? undefined,
    content_revision: item.content_revision,
    created: item.created_at,
    updated: item.updated_at,
    metadata: Object.keys(item.metadata).length > 0 ? item.metadata : undefined,
  });
}

async function ensureItemDir(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  itemRelativePath: string,
): Promise<void> {
  const dir = dirname(itemRelativePath);
  await fs.mkdir(dir ? joinSegments(vaultRootPath, dir) : vaultRootPath);
}

/** Write an item as a YAML-frontmatter markdown document (canonical writer). */
export async function writeItemFile(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  item: ItemFile,
  content: string | null = null,
): Promise<void> {
  const parsed = itemFileSchema.parse(item);
  await ensureItemDir(fs, vaultRootPath, parsed.id);
  const markdown = serializeDocumentMarkdown(
    itemToFrontmatter(parsed),
    content ?? "",
  );
  await fs.writeText(itemMarkdownPath(vaultRootPath, parsed.id), markdown);
  await fs.touch(vaultRootPath);
}

/**
 * Mutate only frontmatter of an existing document, preserving body and any
 * unknown (portable) keys. Used when Collector edits a subset of fields.
 */
export async function updateItemFrontmatter(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  itemRelativePath: string,
  mutate: (frontmatter: Record<string, unknown>) => void,
): Promise<void> {
  const abs = itemMarkdownPath(vaultRootPath, itemRelativePath);
  const raw = await fs.readText(abs);
  const parsed = parseDocumentMarkdown(raw);
  const frontmatter = { ...parsed.frontmatter };
  mutate(frontmatter);
  await fs.writeText(abs, serializeDocumentMarkdown(frontmatter, parsed.body));
  await fs.touch(vaultRootPath);
}

export async function readItemSourceRef(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  itemRelativePath: string,
): Promise<SourceRef | null> {
  const path = itemSourcePath(vaultRootPath, itemRelativePath);
  if (!(await fs.exists(path))) {
    return null;
  }
  const raw = await fs.readText(path);
  return sourceRefSchema.parse(JSON.parse(raw));
}

export async function writeItemSourceRef(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  itemRelativePath: string,
  sourceRef: SourceRef,
): Promise<void> {
  const parsed = sourceRefSchema.parse(sourceRef);
  await fs.mkdir(itemMediaRoot(vaultRootPath, itemRelativePath));
  await fs.writeText(
    itemSourcePath(vaultRootPath, itemRelativePath),
    JSON.stringify(parsed, null, 2),
  );
  await fs.touch(vaultRootPath);
}
