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
import { createAsyncQueue } from "../util/concurrency.js";
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
import { ensureFileMtimeAdvanced } from "./recover-item-mtime.js";
import {
  dirname,
  itemMarkdownPath,
  itemMediaRoot,
  itemSourcePath,
  joinSegments,
  normalizeRelativePath,
  vaultMetaPath,
} from "./paths.js";
import { normalizeTagName, tagSimilarityKey, tagStoredForm } from "./tag-normalize.js";
import { readTagsFile, writeTagsFile } from "./tag-io.js";
import { withTagCatalogLock } from "./tag-catalog-lock.js";

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

export type TagMaps = {
  byName: Map<string, Tag>;
  byId: Map<string, Tag>;
};

export type TagMapsHolder = {
  maps: TagMaps;
};

const tagEnsureQueues = new WeakMap<
  TagMapsHolder,
  ReturnType<typeof createAsyncQueue>
>();

function enqueueTagEnsure<T>(
  holder: TagMapsHolder,
  fn: () => Promise<T>,
): Promise<T> {
  let queue = tagEnsureQueues.get(holder);
  if (!queue) {
    queue = createAsyncQueue();
    tagEnsureQueues.set(holder, queue);
  }
  return queue.enqueue(fn);
}

export async function loadTagMaps(
  fs: FileSystemAdapter,
  vaultPath: string,
): Promise<TagMaps> {
  const file = await readTagsFile(fs, vaultPath);
  return buildTagMaps(file.tags);
}

/**
 * Ensure tag names exist in tags.json; returns refreshed maps.
 * Creates new Tag records for missing similarity keys (portable import).
 * Names are normalized (#943): lookup by similarity key; catalog + new rows
 * use stored form (legacy names like `A/B` are rewritten to `ab` on touch).
 * When creating/renaming, re-reads disk under the vault catalog lock so a stale
 * map cannot clobber tags added concurrently by another document write or prune (#935).
 */
export async function ensureTagsByName(
  fs: FileSystemAdapter,
  vaultPath: string,
  names: string[],
  current?: TagMaps,
): Promise<TagMaps> {
  if (names.length === 0) {
    return current ?? (await loadTagMaps(fs, vaultPath));
  }

  let maps = current ?? (await loadTagMaps(fs, vaultPath));
  const missingByKey = new Map<string, string>();
  let needsRename = false;
  for (const rawName of names) {
    const { storedForm, similarityKey } = normalizeTagName(rawName);
    const existing = maps.byName.get(similarityKey);
    if (!existing) {
      if (!missingByKey.has(similarityKey)) {
        missingByKey.set(similarityKey, storedForm);
      }
      continue;
    }
    if (existing.name !== tagStoredForm(existing.name)) {
      needsRename = true;
    }
  }
  if (missingByKey.size === 0 && !needsRename) {
    return maps;
  }

  return withTagCatalogLock(vaultPath, async () => {
    const file = await readTagsFile(fs, vaultPath);
    maps = buildTagMaps(file.tags);
    let mutated = false;

    for (let i = 0; i < file.tags.length; i++) {
      const tag = file.tags[i]!;
      const stored = tagStoredForm(tag.name);
      if (tag.name === stored) {
        continue;
      }
      const touched = names.some(
        (raw) => normalizeTagName(raw).similarityKey === tagSimilarityKey(tag.name),
      );
      if (!touched) {
        continue;
      }
      file.tags[i] = { ...tag, name: stored };
      mutated = true;
    }
    maps = buildTagMaps(file.tags);

    for (const [similarityKey, storedForm] of missingByKey) {
      if (maps.byName.has(similarityKey)) {
        continue;
      }
      const tag: Tag = {
        id: createId(),
        name: storedForm,
        color: null,
        created_at: nowIso(),
      };
      file.tags.push(tag);
      maps.byName.set(similarityKey, tag);
      maps.byId.set(tag.id, tag);
      mutated = true;
    }

    if (mutated) {
      await writeTagsFile(fs, vaultPath, file);
      maps = buildTagMaps(file.tags);
    }
    return maps;
  });
}

async function parseDocumentWithTags(
  fs: FileSystemAdapter,
  vaultPath: string,
  vaultId: string,
  itemId: string,
  raw: string,
  fallbackMtimeMs: number | null,
): Promise<{ item: ItemFile; body: string }> {
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
  tagMaps?: TagMapsHolder,
): Promise<ItemFile> {
  let maps = tagMaps?.maps ?? (await loadTagMaps(fs, vaultPath));
  const fallbackIso = mtimeToIso(diskMtimeMs);
  const first = parseItemDocument(raw, {
    itemId,
    vaultId,
    tagsByName: maps.byName,
    fallbackCreatedAt: fallbackIso,
    fallbackUpdatedAt: fallbackIso,
  });
  const namesToEnsure = [...first.missingTagNames];
  for (const tagId of first.item.tag_ids) {
    const tag = maps.byId.get(tagId);
    if (tag && tag.name !== tagStoredForm(tag.name)) {
      namesToEnsure.push(tag.name);
    }
  }
  if (namesToEnsure.length > 0) {
    if (tagMaps) {
      maps = await enqueueTagEnsure(tagMaps, async () => {
        const next = await ensureTagsByName(
          fs,
          vaultPath,
          namesToEnsure,
          tagMaps.maps,
        );
        tagMaps.maps = next;
        return next;
      });
    } else {
      maps = await ensureTagsByName(fs, vaultPath, namesToEnsure, maps);
    }
  }
  return parseItemDocumentResolved(raw, {
    itemId,
    vaultId,
    tagsByName: maps.byName,
    fallbackCreatedAt: fallbackIso,
    fallbackUpdatedAt: fallbackIso,
  }).item;
}

export async function readItemDocument(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  itemRelativePath: string,
  vaultId: string,
): Promise<{ item: ItemFile; body: string }> {
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
  options?: {
    tagsById?: Map<string, Tag>;
    /** Caller already holds withTagCatalogLock for this vault. */
    assumeCatalogLocked?: boolean;
    /** Exact FM tag spellings to preserve (#949); see serializeItemDocument. */
    preferredTagNames?: string[];
  },
): Promise<void> {
  const parsed = itemFileSchema.parse({
    ...item,
    id: normalizeRelativePath(item.id),
    folder_path: folderPathFromItemPath(item.id),
  });
  await ensureParentDir(fs, vaultRootPath, parsed.id);
  let tagsById: Map<string, Tag>;
  if (options?.assumeCatalogLocked) {
    if (!options.tagsById) {
      throw new Error(
        `writeItemDocument(${parsed.id}): assumeCatalogLocked requires tagsById`,
      );
    }
    tagsById = options.tagsById;
    for (const tagId of parsed.tag_ids) {
      if (!tagsById.has(tagId)) {
        throw new Error(
          `Cannot write item ${parsed.id}: unknown tag_id ${tagId}`,
        );
      }
    }
  } else {
    let maps = options?.tagsById
      ? buildTagMaps([...options.tagsById.values()])
      : await loadTagMaps(fs, vaultRootPath);
    const names: string[] = [];
    for (const tagId of parsed.tag_ids) {
      const tag = maps.byId.get(tagId);
      if (!tag) {
        throw new Error(
          `Cannot write item ${parsed.id}: unknown tag_id ${tagId}`,
        );
      }
      names.push(tag.name);
    }
    if (names.length > 0) {
      maps = await ensureTagsByName(fs, vaultRootPath, names, maps);
    }
    tagsById = maps.byId;
  }
  const markdown = serializeItemDocument(parsed, body, tagsById, {
    preferredTagNames: options?.preferredTagNames,
  });
  const docPath = itemMarkdownPath(vaultRootPath, parsed.id);
  const before = await fs.stat(docPath);
  await fs.writeText(docPath, markdown);
  if (before.mtimeMs !== null) {
    await ensureFileMtimeAdvanced(fs, docPath, before.mtimeMs);
  }
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
  let properties = item.properties ?? {};
  if (await fs.exists(docPath)) {
    const raw = await fs.readText(docPath);
    const parsed = parseDocumentMarkdown(raw);
    body = parsed.body;
    if (Object.keys(properties).length === 0) {
      properties = extractUnknownFrontmatterKeys(parsed.frontmatter);
    }
  }
  await writeItemDocument(fs, vaultRootPath, { ...item, id, properties }, body);
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
  await writeItemDocument(fs, vaultRootPath, existing.item, content);
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
  // Shared `media/<noteUuid>/` (#279), not a sibling `*.media` sidecar.
  await fs.mkdir(itemMediaRoot(vaultRootPath, itemRelativePath));
  await fs.writeText(
    itemSourcePath(vaultRootPath, itemRelativePath),
    JSON.stringify(parsed, null, 2),
  );
  await fs.touch(vaultRootPath);
}

export { joinSegments, normalizeRelativePath };
