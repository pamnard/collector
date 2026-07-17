import type {
  FileSystemAdapter,
  VaultItemMetaRead,
  VaultItemStatMeta,
} from "../adapters/types.js";
import {
  INDEX_SYNC_WRITE_BATCH,
  INDEX_SYNC_YIELD_MS,
  yieldToEventLoop,
} from "../util/concurrency.js";
import { itemMarkdownPath } from "./paths.js";
import { listItemRelativePaths } from "./scan.js";

/** Max item ids per batched read-meta IPC call; aligned with write batch for yield cadence. */
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
  const results: VaultItemStatMeta[] = [];
  for (const itemId of itemIds) {
    const fileStat = await fs.stat(itemMarkdownPath(vaultPath, itemId));
    results.push({ id: itemId, mtimeMs: fileStat.mtimeMs });
  }
  return results;
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
  for (let i = 0; i < itemIds.length; i += 1) {
    const itemId = itemIds[i]!;
    const docPath = itemMarkdownPath(vaultPath, itemId);
    if (!(await fs.exists(docPath))) {
      continue;
    }
    const documentMarkdown = await fs.readText(docPath);
    results.push({ id: itemId, documentMarkdown });
    if ((i + 1) % VAULT_ITEM_READ_META_BATCH === 0 && i + 1 < itemIds.length) {
      await yieldToEventLoop(INDEX_SYNC_YIELD_MS);
    }
  }
  return results;
}
