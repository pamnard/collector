import type { ItemFile } from "@collector/shared";
import type { UpsertItemInput, VaultContext } from "../adapters/types.js";
import { nowIso } from "../util/ids.js";
import { ftsFieldsFromDocumentMarkdown } from "./frontmatter.js";
import {
  itemFileFromDocumentMarkdown,
  loadTagMaps,
  readItemFile,
  readItemSourceRef,
  readVaultMeta,
  writeItemDocument,
  writeItemSourceRef,
  type TagMapsHolder,
} from "./item-io.js";
import { syncTagsToIndex } from "./tag-operations.js";
import { DISK_ITEM_READ_CONCURRENCY } from "../util/concurrency.js";
import {
  folderPathFromItemId,
  itemMarkdownPath,
  noteSharedMediaRoot,
  noteUuidFromItemPath,
  normalizeRelativePath,
} from "./paths.js";
import { listItemRelativePaths } from "./scan.js";
import { diskMtimeMsFromDocumentMarkdown } from "./recover-item-mtime.js";
import { readVaultItemMetaBatch } from "./vault-fs-batch.js";
import { refreshItemEmbeddingAfterWrite } from "./item-embedding-refresh.js";

export async function upsertItem(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  input: UpsertItemInput,
): Promise<ItemFile> {
  const timestamp = nowIso();
  const id = normalizeRelativePath(input.item.id);
  const item: ItemFile = {
    ...input.item,
    id,
    vault_id: vaultId,
    // Collections are real FS folders (#134): folder_path is always the
    // dirname of id, never an independent value supplied by the caller.
    folder_path: folderPathFromItemId(id),
    updated_at: timestamp,
    created_at: input.item.created_at || timestamp,
  };

  const body = input.content ?? "";
  await writeItemDocument(ctx.fs, vaultPath, item, body);

  if (input.sourceRef) {
    await writeItemSourceRef(ctx.fs, vaultPath, item.id, input.sourceRef);
  }

  const docPath = itemMarkdownPath(vaultPath, item.id);
  const documentMarkdown = await ctx.fs.readText(docPath);
  const fts = ftsFieldsFromDocumentMarkdown(documentMarkdown);
  const sourceRef =
    input.sourceRef ?? (await readItemSourceRef(ctx.fs, vaultPath, item.id));
  const fileStat = await ctx.fs.stat(docPath);

  await ctx.index.upsertItem(
    {
      item,
      content: fts.content,
      hasContentFile: fts.hasContentFile,
      sourceRef,
      fileMtimeMs: fileStat.mtimeMs,
    },
    vaultId,
  );
  await refreshItemEmbeddingAfterWrite(ctx, vaultPath, vaultId, item, fts.content);
  return item;
}

/**
 * Replace the vault `.md` with caller-supplied raw markdown (no re-serialize),
 * then re-parse into the index. Creates missing tags from frontmatter names.
 */
export async function writeItemRawMarkdown(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  itemId: string,
  raw: string,
): Promise<ItemFile> {
  const id = normalizeRelativePath(itemId);
  const docPath = itemMarkdownPath(vaultPath, id);
  if (!(await ctx.fs.exists(docPath))) {
    throw new Error(`Item not found: ${id}`);
  }

  const existingStat = await ctx.fs.stat(docPath);
  if (existingStat.mtimeMs === null) {
    throw new Error(`Cannot write item document ${id}: missing file mtime`);
  }

  const item = await itemFileFromDocumentMarkdown(
    ctx.fs,
    vaultPath,
    vaultId,
    id,
    raw,
    existingStat.mtimeMs,
  );
  const fts = ftsFieldsFromDocumentMarkdown(raw);

  await ctx.fs.writeText(docPath, raw);
  await ctx.fs.touch(vaultPath);

  const sourceRef = await readItemSourceRef(ctx.fs, vaultPath, id);
  const fileStat = await ctx.fs.stat(docPath);

  // ensureTagsByName (via parse) only updates tags.json; index FK needs tags rows.
  await syncTagsToIndex(ctx, vaultPath, vaultId);

  await ctx.index.upsertItem(
    {
      item,
      content: fts.content,
      hasContentFile: fts.hasContentFile,
      sourceRef,
      fileMtimeMs: fileStat.mtimeMs,
    },
    vaultId,
  );
  await refreshItemEmbeddingAfterWrite(ctx, vaultPath, vaultId, item, fts.content);
  return item;
}

export async function deleteItem(
  ctx: VaultContext,
  vaultPath: string,
  itemId: string,
): Promise<void> {
  const id = normalizeRelativePath(itemId);
  const docPath = itemMarkdownPath(vaultPath, id);
  if (await ctx.fs.exists(docPath)) {
    await ctx.fs.remove(docPath);
  }
  const mediaRoot = noteSharedMediaRoot(vaultPath, noteUuidFromItemPath(id));
  if (await ctx.fs.exists(mediaRoot)) {
    await ctx.fs.remove(mediaRoot, { recursive: true });
  }
  await ctx.fs.touch(vaultPath);
  await ctx.index.deleteItem(id);
}

export async function listItemsOnDisk(
  ctx: VaultContext,
  vaultPath: string,
): Promise<ItemFile[]> {
  if (!(await ctx.fs.exists(vaultPath))) {
    return [];
  }

  const itemIds = await listItemRelativePaths(ctx.fs, vaultPath);
  return listItemsByIds(ctx, vaultPath, itemIds);
}

export interface StreamedItemRead {
  index: number;
  itemId: string;
  item: ItemFile | null;
}

export interface StreamItemsByIdsOptions {
  concurrency?: number;
  onItem: (result: StreamedItemRead) => void;
  signal?: AbortSignal;
}

async function readItemFromDisk(
  ctx: VaultContext,
  vaultPath: string,
  itemId: string,
): Promise<ItemFile | null> {
  const docPath = itemMarkdownPath(vaultPath, itemId);
  if (!(await ctx.fs.exists(docPath))) {
    return null;
  }
  const meta = await readVaultMeta(ctx.fs, vaultPath);
  return readItemFile(ctx.fs, vaultPath, itemId, meta.id);
}

/** Read item documents; uses batched FS when the adapter supports it. */
export async function streamItemsByIds(
  ctx: VaultContext,
  vaultPath: string,
  itemIds: string[],
  options: StreamItemsByIdsOptions,
): Promise<void> {
  if (!itemIds.length) {
    return;
  }

  const { concurrency, onItem, signal } = options;
  const vaultMeta = await readVaultMeta(ctx.fs, vaultPath);
  const vaultId = vaultMeta.id;

  if (ctx.fs.readVaultItemsMeta) {
    const batchReads = await readVaultItemMetaBatch(ctx.fs, vaultPath, itemIds);
    const readById = new Map(batchReads.map((read) => [read.id, read]));
    const tagMaps: TagMapsHolder = {
      maps: await loadTagMaps(ctx.fs, vaultPath),
    };
    for (const [index, itemId] of itemIds.entries()) {
      if (signal?.aborted) {
        return;
      }
      const batchRead = readById.get(itemId);
      let item: ItemFile | null = null;
      if (batchRead) {
        try {
          let diskMtimeMs =
            batchRead.mtimeMs === undefined ? null : batchRead.mtimeMs;
          if (diskMtimeMs === null) {
            diskMtimeMs = diskMtimeMsFromDocumentMarkdown(
              batchRead.documentMarkdown,
            );
          }
          item = await itemFileFromDocumentMarkdown(
            ctx.fs,
            vaultPath,
            vaultId,
            itemId,
            batchRead.documentMarkdown,
            diskMtimeMs,
            tagMaps,
          );
        } catch {
          item = null;
        }
      }
      onItem({ index, itemId, item });
    }
    return;
  }

  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      if (signal?.aborted) {
        return;
      }

      const index = nextIndex;
      nextIndex += 1;
      if (index >= itemIds.length) {
        return;
      }

      const itemId = itemIds[index]!;
      const item = await readItemFromDisk(ctx, vaultPath, itemId);
      if (signal?.aborted) {
        return;
      }

      onItem({ index, itemId, item });
    }
  }

  const workerCount = Math.min(
    concurrency ?? DISK_ITEM_READ_CONCURRENCY,
    itemIds.length,
  );
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

export async function listItemsByIds(
  ctx: VaultContext,
  vaultPath: string,
  itemIds: string[],
): Promise<ItemFile[]> {
  const slots: Array<ItemFile | null> = new Array(itemIds.length);
  await streamItemsByIds(ctx, vaultPath, itemIds, {
    onItem: ({ index, item }) => {
      slots[index] = item;
    },
  });

  const items: ItemFile[] = [];
  for (const item of slots) {
    if (item) {
      items.push(item);
    }
  }
  return items;
}
