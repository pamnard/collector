import type {
  FileSystemAdapter,
  VaultItemMetaRead,
  VaultItemStatMeta,
} from "../adapters/types.js";
import { itemMetaPath, itemRoot, itemsRoot } from "./paths.js";

/** Max item ids per batched read-meta IPC call. */
export const VAULT_ITEM_READ_META_BATCH = 256;

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

  const itemsDir = itemsRoot(vaultPath);
  if (!(await fs.exists(itemsDir))) {
    return [];
  }

  const itemIds = await fs.readDir(itemsDir);
  const results: VaultItemStatMeta[] = [];
  for (const itemId of itemIds) {
    const fileStat = await fs.stat(itemMetaPath(itemRoot(vaultPath, itemId)));
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
    }
    return results;
  }

  const results: VaultItemMetaRead[] = [];
  for (const itemId of itemIds) {
    const itemPath = itemRoot(vaultPath, itemId);
    const metaPath = itemMetaPath(itemPath);
    if (!(await fs.exists(metaPath))) {
      continue;
    }
    const itemJson = await fs.readText(metaPath);
    results.push({ id: itemId, itemJson });
  }
  return results;
}
