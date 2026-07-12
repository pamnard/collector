import type { ItemFile, VaultMeta } from "@collector/shared";
import { SCHEMA_VERSION } from "@collector/shared";
import type {
  CreateVaultInput,
  SyncReport,
  UpsertItemInput,
  VaultContext,
} from "../adapters/types.js";
import { createId, nowIso } from "../util/ids.js";
import {
  readItemContent,
  readItemFile,
  readItemSourceRef,
  writeItemContent,
  writeItemFile,
  writeItemSourceRef,
  writeVaultMeta,
} from "./item-io.js";
import {
  itemMediaRoot,
  itemRoot,
  itemsRoot,
  vaultRoot,
  vaultsRoot,
} from "./paths.js";

export async function createVault(
  ctx: VaultContext,
  dataDir: string,
  input: CreateVaultInput,
): Promise<{ meta: VaultMeta; path: string }> {
  const vaultId = createId();
  const timestamp = nowIso();
  const meta: VaultMeta = {
    id: vaultId,
    name: input.name,
    description: input.description ?? "",
    is_default: input.isDefault ?? false,
    schema_version: SCHEMA_VERSION,
    settings: {},
    created_at: timestamp,
    updated_at: timestamp,
  };

  const root = vaultsRoot(dataDir);
  const vaultPath = vaultRoot(root, vaultId);

  await ctx.fs.mkdir(vaultPath);
  await ctx.fs.mkdir(itemsRoot(vaultPath));
  await writeVaultMeta(ctx.fs, vaultPath, meta);
  await ctx.index.upsertVault(meta, vaultPath);

  return { meta, path: vaultPath };
}

export async function upsertItem(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  input: UpsertItemInput,
): Promise<ItemFile> {
  const timestamp = nowIso();
  const item: ItemFile = {
    ...input.item,
    vault_id: vaultId,
    updated_at: timestamp,
    created_at: input.item.created_at || timestamp,
  };

  const itemPath = itemRoot(vaultPath, item.id);
  await ctx.fs.mkdir(itemPath);
  await ctx.fs.mkdir(itemMediaRoot(itemPath));
  await writeItemFile(ctx.fs, itemPath, item);

  if (input.content) {
    await writeItemContent(ctx.fs, itemPath, input.content);
  }

  if (input.sourceRef) {
    await writeItemSourceRef(ctx.fs, itemPath, input.sourceRef);
  }

  const content = input.content ?? (await readItemContent(ctx.fs, itemPath));
  const sourceRef = input.sourceRef ?? (await readItemSourceRef(ctx.fs, itemPath));

  await ctx.index.upsertItem({ item, content, sourceRef }, vaultId);
  return item;
}

export async function deleteItem(
  ctx: VaultContext,
  vaultPath: string,
  itemId: string,
): Promise<void> {
  const itemPath = itemRoot(vaultPath, itemId);
  if (await ctx.fs.exists(itemPath)) {
    await ctx.fs.remove(itemPath, { recursive: true });
  }
  await ctx.index.deleteItem(itemId);
}

export async function syncIndexFromFilesystem(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
): Promise<SyncReport> {
  const report: SyncReport = { indexed: 0, removed: 0, errors: [] };
  const itemsDir = itemsRoot(vaultPath);

  if (!(await ctx.fs.exists(itemsDir))) {
    return report;
  }

  const diskItemIds = new Set(await ctx.fs.readDir(itemsDir));
  const indexedIds = new Set(await ctx.index.listVaultItemIds(vaultId));

  for (const itemId of diskItemIds) {
    const itemPath = itemRoot(vaultPath, itemId);
    try {
      const item = await readItemFile(ctx.fs, itemPath);
      const content = await readItemContent(ctx.fs, itemPath);
      const sourceRef = await readItemSourceRef(ctx.fs, itemPath);
      await ctx.index.upsertItem({ item, content, sourceRef }, vaultId);
      report.indexed += 1;
    } catch (error) {
      report.errors.push({
        itemId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const indexedId of indexedIds) {
    if (!diskItemIds.has(indexedId)) {
      await ctx.index.deleteItem(indexedId);
      report.removed += 1;
    }
  }

  return report;
}

export async function listItemsOnDisk(
  ctx: VaultContext,
  vaultPath: string,
): Promise<ItemFile[]> {
  const itemsDir = itemsRoot(vaultPath);
  if (!(await ctx.fs.exists(itemsDir))) {
    return [];
  }

  const itemIds = await ctx.fs.readDir(itemsDir);
  const items: ItemFile[] = [];

  for (const itemId of itemIds) {
    const itemPath = itemRoot(vaultPath, itemId);
    items.push(await readItemFile(ctx.fs, itemPath));
  }

  return items;
}

export async function listItemsByIds(
  ctx: VaultContext,
  vaultPath: string,
  itemIds: string[],
): Promise<ItemFile[]> {
  const items: ItemFile[] = [];

  for (const itemId of itemIds) {
    const itemPath = itemRoot(vaultPath, itemId);
    if (!(await ctx.fs.exists(itemPath))) {
      continue;
    }
    items.push(await readItemFile(ctx.fs, itemPath));
  }

  return items;
}
