import {
  folderPathFromItemPath,
  itemFileSchema,
  sourceRefSchema,
  vaultMetaSchema,
  type ItemFile,
  type SourceRef,
  type Tag,
  type VaultMeta,
} from "@collector/shared";
import type { FileSystemAdapter } from "../adapters/types.js";
import { createId, nowIso } from "../util/ids.js";
import {
  extractUnknownFrontmatterKeys,
  parseDocumentMarkdown,
} from "./frontmatter.js";
import {
  buildTagMaps,
  parseItemDocument,
  parseItemDocumentResolved,
  serializeItemDocument,
} from "./item-document.js";
import {
  dirname,
  itemMarkdownPath,
  itemMediaRoot,
  itemSourcePath,
  joinSegments,
  normalizeRelativePath,
  vaultMetaPath,
} from "./paths.js";
import { readTagsFile, writeTagsFile } from "./tag-io.js";

function mtimeToIso(mtimeMs: number | null): string {
  if (mtimeMs === null) {
    throw new Error("Cannot derive ISO date from missing file mtime");
  }
  return new Date(mtimeMs).toISOString();
}

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

async function loadTagMaps(
  fs: FileSystemAdapter,
  vaultPath: string,
): Promise<{ byName: Map<string, Tag>; byId: Map<string, Tag> }> {
  const file = await readTagsFile(fs, vaultPath);
  return buildTagMaps(file.tags);
}

/**
 * Ensure tag names exist in tags.json; returns refreshed maps.
 * Creates new Tag records for missing names (portable import).
 */
export async function ensureTagsByName(
  fs: FileSystemAdapter,
  vaultPath: string,
  names: string[],
): Promise<{ byName: Map<string, Tag>; byId: Map<string, Tag> }> {
  if (names.length === 0) {
    return loadTagMaps(fs, vaultPath);
  }

  const file = await readTagsFile(fs, vaultPath);
  let maps = buildTagMaps(file.tags);
  let mutated = false;

  for (const rawName of names) {
    const normalized = rawName.trim();
    if (!normalized) {
      throw new Error("Tag name must be non-empty");
    }
    const key = normalized.toLowerCase();
    if (maps.byName.has(key)) {
      continue;
    }
    const tag: Tag = {
      id: createId(),
      name: normalized,
      color: null,
      created_at: nowIso(),
    };
    file.tags.push(tag);
    mutated = true;
    maps = buildTagMaps(file.tags);
  }

  if (mutated) {
    await writeTagsFile(fs, vaultPath, file);
    maps = buildTagMaps(file.tags);
  }
  return maps;
}

async function parseDocumentWithTags(
  fs: FileSystemAdapter,
  vaultPath: string,
  vaultId: string,
  itemId: string,
  raw: string,
  fallbackMtimeMs: number | null,
): Promise<{ item: ItemFile; body: string; extra: Record<string, unknown> }> {
  const maps = await loadTagMaps(fs, vaultPath);
  const fallbackIso =
    fallbackMtimeMs !== null ? mtimeToIso(fallbackMtimeMs) : undefined;
  return parseItemDocumentResolved(raw, {
    itemId,
    vaultId,
    tagsByName: maps.byName,
    fallbackCreatedAt: fallbackIso,
    fallbackUpdatedAt: fallbackIso,
  });
}

/**
 * Parse raw document markdown into ItemFile, creating missing tags as needed.
 * Used by batch sync / portable import paths that already have the file contents.
 */
export async function itemFileFromDocumentMarkdown(
  fs: FileSystemAdapter,
  vaultPath: string,
  vaultId: string,
  itemId: string,
  raw: string,
  diskMtimeMs: number,
): Promise<ItemFile> {
  const maps = await loadTagMaps(fs, vaultPath);
  const fallbackIso = mtimeToIso(diskMtimeMs);
  const first = parseItemDocument(raw, {
    itemId,
    vaultId,
    tagsByName: maps.byName,
    fallbackCreatedAt: fallbackIso,
    fallbackUpdatedAt: fallbackIso,
  });
  if (first.missingTagNames.length === 0) {
    return first.item;
  }
  const refreshed = await ensureTagsByName(fs, vaultPath, first.missingTagNames);
  return parseItemDocumentResolved(raw, {
    itemId,
    vaultId,
    tagsByName: refreshed.byName,
    fallbackCreatedAt: fallbackIso,
    fallbackUpdatedAt: fallbackIso,
  }).item;
}

export async function readItemDocument(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  itemRelativePath: string,
  vaultId: string,
): Promise<{ item: ItemFile; body: string; extra: Record<string, unknown> }> {
  const id = normalizeRelativePath(itemRelativePath);
  const docPath = itemMarkdownPath(vaultRootPath, id);
  if (!(await fs.exists(docPath))) {
    throw new Error(`Missing item document: ${id}`);
  }
  const raw = await fs.readText(docPath);
  const fileStat = await fs.stat(docPath);
  return parseDocumentWithTags(
    fs,
    vaultRootPath,
    vaultId,
    id,
    raw,
    fileStat.mtimeMs,
  );
}

/** Read the vault `.md` file bytes as-is (frontmatter + body). */
export async function readItemRawMarkdown(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  itemRelativePath: string,
): Promise<string> {
  const id = normalizeRelativePath(itemRelativePath);
  const docPath = itemMarkdownPath(vaultRootPath, id);
  if (!(await fs.exists(docPath))) {
    throw new Error(`Missing item document: ${id}`);
  }
  return fs.readText(docPath);
}

async function ensureParentDir(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  itemRelativePath: string,
): Promise<void> {
  const dir = dirname(itemRelativePath);
  await fs.mkdir(dir ? joinSegments(vaultRootPath, dir) : vaultRootPath);
}

export async function writeItemDocument(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  item: ItemFile,
  body: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  const parsed = itemFileSchema.parse({
    ...item,
    id: normalizeRelativePath(item.id),
    folder_path: folderPathFromItemPath(item.id),
  });
  await ensureParentDir(fs, vaultRootPath, parsed.id);
  const maps = await loadTagMaps(fs, vaultRootPath);
  const markdown = serializeItemDocument(parsed, body, maps.byId, extra);
  await fs.writeText(itemMarkdownPath(vaultRootPath, parsed.id), markdown);
  await fs.touch(vaultRootPath);
}

export async function readItemFile(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  itemRelativePath: string,
  vaultId: string,
): Promise<ItemFile> {
  const doc = await readItemDocument(fs, vaultRootPath, itemRelativePath, vaultId);
  return doc.item;
}

export async function writeItemFile(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  item: ItemFile,
): Promise<void> {
  const id = normalizeRelativePath(item.id);
  const docPath = itemMarkdownPath(vaultRootPath, id);
  let body = "";
  let extra: Record<string, unknown> | undefined;
  if (await fs.exists(docPath)) {
    const raw = await fs.readText(docPath);
    const parsed = parseDocumentMarkdown(raw);
    body = parsed.body;
    extra = extractUnknownFrontmatterKeys(parsed.frontmatter);
  }
  await writeItemDocument(fs, vaultRootPath, { ...item, id }, body, extra);
}

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

export async function writeItemContent(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  itemRelativePath: string,
  content: string,
  vaultId: string,
): Promise<void> {
  const existing = await readItemDocument(
    fs,
    vaultRootPath,
    itemRelativePath,
    vaultId,
  );
  await writeItemDocument(
    fs,
    vaultRootPath,
    existing.item,
    content,
    existing.extra,
  );
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

export { joinSegments, normalizeRelativePath };
