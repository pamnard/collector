import { sourceRefSchema, type SourceRef } from "@collector/shared";
import type {
  FileSystemAdapter,
  VaultItemMetaRead,
  VaultItemStatMeta,
} from "../adapters/types.js";
import {
  DISK_ITEM_READ_CONCURRENCY,
  INDEX_SYNC_WRITE_BATCH,
  INDEX_SYNC_YIELD_MS,
  runWithConcurrencyYielding,
  yieldToEventLoop,
} from "../util/concurrency.js";
import { itemMarkdownPath } from "./paths.js";
import { readItemSourceRef } from "./item-io.js";
import { listItemRelativePaths } from "./scan.js";

/** Max item ids per batched read-meta call; aligned with write batch for yield cadence. */
export const VAULT_ITEM_READ_META_BATCH = INDEX_SYNC_WRITE_BATCH;

export function hasVaultFsBatch(fs: FileSystemAdapter): boolean {
  return (
    typeof fs.statVaultItemsMeta === "function" &&
    typeof fs.readVaultItemsMeta === "function"
  );
}

export async function statAllVaultItemMeta(
  fs: FileSystemAdapter,
  vaultPath: string,
): Promise<VaultItemStatMeta[]> {
  if (fs.statVaultItemsMeta) {
    return fs.statVaultItemsMeta(vaultPath);
  }

  const itemIds = await listItemRelativePaths(fs, vaultPath);
  return statVaultItemMetaBatch(fs, vaultPath, itemIds);
}

/**
 * Exists + stat for an explicit id set (watcher reconcile).
 * Missing paths are omitted from the result (caller treats absence as delete).
 */
export async function statVaultItemMetaBatch(
  fs: FileSystemAdapter,
  vaultPath: string,
  itemIds: string[],
): Promise<VaultItemStatMeta[]> {
  if (!itemIds.length) {
    return [];
  }

  const results = await runWithConcurrencyYielding(
    itemIds.length,
    DISK_ITEM_READ_CONCURRENCY,
    async (index) => {
      const itemId = itemIds[index]!;
      const docPath = itemMarkdownPath(vaultPath, itemId);
      if (!(await fs.exists(docPath))) {
        return null;
      }
      const fileStat = await fs.stat(docPath);
      // TOCTOU: NodeFileSystemAdapter maps ENOENT (and other errors) to null
      // mtime. Re-check so a deleted path is omitted (caller deletes index row)
      // instead of "present + null mtime" → Missing document.
      if (fileStat.mtimeMs === null && !(await fs.exists(docPath))) {
        return null;
      }
      return { id: itemId, mtimeMs: fileStat.mtimeMs };
    },
    { yieldEvery: VAULT_ITEM_READ_META_BATCH, yieldMs: INDEX_SYNC_YIELD_MS },
  );

  const present: VaultItemStatMeta[] = [];
  for (const entry of results) {
    if (entry) {
      present.push(entry);
    }
  }
  return present;
}

export async function readVaultItemMetaBatch(
  fs: FileSystemAdapter,
  vaultPath: string,
  itemIds: string[],
): Promise<VaultItemMetaRead[]> {
  if (!itemIds.length) {
    return [];
  }

  if (fs.readVaultItemsMeta) {
    const results: VaultItemMetaRead[] = [];
    for (let offset = 0; offset < itemIds.length; offset += VAULT_ITEM_READ_META_BATCH) {
      const chunk = itemIds.slice(offset, offset + VAULT_ITEM_READ_META_BATCH);
      const chunkResults = await fs.readVaultItemsMeta(vaultPath, chunk);
      results.push(...chunkResults);
      if (offset + chunk.length < itemIds.length) {
        await yieldToEventLoop(INDEX_SYNC_YIELD_MS);
      }
    }
    return results;
  }

  const results: VaultItemMetaRead[] = [];
  const reads = await runWithConcurrencyYielding(
    itemIds.length,
    DISK_ITEM_READ_CONCURRENCY,
    async (index) => {
      const itemId = itemIds[index]!;
      const docPath = itemMarkdownPath(vaultPath, itemId);
      if (!(await fs.exists(docPath))) {
        return null;
      }
      const documentMarkdown = await fs.readText(docPath);
      const fileStat = await fs.stat(docPath);
      return {
        id: itemId,
        documentMarkdown,
        mtimeMs: fileStat.mtimeMs,
      };
    },
    { yieldEvery: VAULT_ITEM_READ_META_BATCH, yieldMs: INDEX_SYNC_YIELD_MS },
  );

  for (const entry of reads) {
    if (entry) {
      results.push(entry);
    }
  }
  return results;
}

export async function readVaultItemSourceRefBatch(
  fs: FileSystemAdapter,
  vaultPath: string,
  itemIds: string[],
): Promise<Map<string, SourceRef | null>> {
  const results = new Map<string, SourceRef | null>();
  if (!itemIds.length) {
    return results;
  }

  if (fs.readVaultItemSourceRefs) {
    for (let offset = 0; offset < itemIds.length; offset += VAULT_ITEM_READ_META_BATCH) {
      const chunk = itemIds.slice(offset, offset + VAULT_ITEM_READ_META_BATCH);
      const chunkResults = await fs.readVaultItemSourceRefs(vaultPath, chunk);
      const sourceJsonById = new Map(chunkResults.map((read) => [read.id, read.sourceJson]));
      for (const itemId of chunk) {
        const sourceJson = sourceJsonById.get(itemId);
        if (sourceJson === undefined) {
          throw new Error(`Missing source reference result for ${itemId}`);
        }
        results.set(
          itemId,
          sourceJson === null ? null : sourceRefSchema.parse(JSON.parse(sourceJson)),
        );
      }
      if (offset + chunk.length < itemIds.length) {
        await yieldToEventLoop(INDEX_SYNC_YIELD_MS);
      }
    }
    return results;
  }

  const sourceRefs = await runWithConcurrencyYielding(
    itemIds.length,
    DISK_ITEM_READ_CONCURRENCY,
    async (index) => {
      const itemId = itemIds[index]!;
      return {
        itemId,
        sourceRef: await readItemSourceRef(fs, vaultPath, itemId),
      };
    },
    { yieldEvery: VAULT_ITEM_READ_META_BATCH, yieldMs: INDEX_SYNC_YIELD_MS },
  );
  for (const entry of sourceRefs) {
    results.set(entry.itemId, entry.sourceRef);
  }
  return results;
}
