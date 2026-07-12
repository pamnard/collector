import { appDataDir, join } from "@tauri-apps/api/path";
import { runMigrations } from "@collector/db";
import type { ItemFile, VaultMeta } from "@collector/shared";
import {
  SqlVaultIndexStore,
  buildFtsMatchQuery,
  createVault,
  deleteItem as deleteItemOnDisk,
  itemRoot,
  listItemsByIds,
  listItemsOnDisk,
  migrateVaultSchema,
  readItemContent,
  readItemFile,
  syncIndexFromFilesystem,
  upsertItem,
  vaultMetaPath,
  vaultRoot,
  vaultsRoot,
  writeVaultMeta,
  createTag as createTagOnVault,
  deleteTag as deleteTagOnVault,
  listTagsWithCounts,
  syncTagsToIndex,
  updateTag as updateTagOnVault,
  createFolder as createFolderOnVault,
  deleteFolder as deleteFolderOnVault,
  listFolderTree as listFolderTreeOnVault,
  moveItemToFolder,
  renameFolder as renameFolderOnVault,
} from "@collector/core";
import type { FolderTreeNode, TagWithCount } from "@collector/core";
import type { Tag } from "@collector/shared";
import type { CreateItemInput, UpdateItemInput } from "../types/item";
import type { NavFilter } from "../types/ui";
import { isFolderFilter, isTagFilter } from "../types/ui";
import { TauriFileSystemAdapter } from "../adapters/tauri-fs";
import { TauriSqlAdapter } from "../adapters/tauri-sql";
import {
  ensureAppSettings,
  updateAppSettings,
} from "./app-settings-service";

let initialized = false;
let dataDir = "";
let sql: TauriSqlAdapter | null = null;
let activeVault: { meta: VaultMeta; path: string } | null = null;
const syncedVaultIds = new Set<string>();
const fs = new TauriFileSystemAdapter();

type VaultEntry = { meta: VaultMeta; path: string };

async function listVaultEntries(): Promise<VaultEntry[]> {
  await ensureInitialized();
  const root = vaultsRoot(dataDir);
  if (!(await fs.exists(root))) {
    return [];
  }

  const entries: VaultEntry[] = [];
  for (const vaultId of await fs.readDir(root)) {
    const path = vaultRoot(root, vaultId);
    if (await fs.exists(vaultMetaPath(path))) {
      const meta = await migrateVaultSchema(fs, path);
      entries.push({ meta, path });
    }
  }

  return entries.sort((a, b) => a.meta.name.localeCompare(b.meta.name));
}

async function ensureInitialized(): Promise<void> {
  if (initialized) {
    return;
  }

  dataDir = await join(await appDataDir(), "collector");
  sql = await TauriSqlAdapter.open();
  await runMigrations(sql);
  await fs.mkdir(dataDir);
  initialized = true;
}

function getIndex(): SqlVaultIndexStore {
  if (!sql) {
    throw new Error("Collector database is not initialized");
  }
  return new SqlVaultIndexStore(sql);
}

function getContext() {
  return { fs, index: getIndex() };
}

async function ensureVaultIndexSynced(
  vaultId: string,
  vaultPath: string,
): Promise<void> {
  if (syncedVaultIds.has(vaultId)) {
    return;
  }

  await syncIndexFromFilesystem(getContext(), vaultPath, vaultId);
  await syncTagsToIndex(getContext(), vaultPath, vaultId);
  syncedVaultIds.add(vaultId);
}

function pickVaultEntry(
  entries: VaultEntry[],
  preferredId: string | null,
): VaultEntry | null {
  if (preferredId) {
    const stored = entries.find((entry) => entry.meta.id === preferredId);
    if (stored) {
      return stored;
    }
  }

  const defaultVault = entries.find((entry) => entry.meta.is_default);
  if (defaultVault) {
    return defaultVault;
  }

  return entries[0] ?? null;
}

async function resolveActiveVault(): Promise<{ vault: VaultMeta; path: string }> {
  await ensureInitialized();

  if (activeVault) {
    return { vault: activeVault.meta, path: activeVault.path };
  }

  const ctx = getContext();
  const root = vaultsRoot(dataDir);
  await fs.mkdir(root);

  const settings = await ensureAppSettings();
  const storedVaultId = settings.active_vault_id ?? null;
  const existing = await listVaultEntries();
  const selected = pickVaultEntry(existing, storedVaultId);

  let meta: VaultMeta | null = selected?.meta ?? null;
  let vaultPath = selected?.path ?? "";

  if (!meta) {
    const created = await createVault(ctx, dataDir, {
      name: "Default Vault",
      isDefault: true,
    });
    meta = created.meta;
    vaultPath = created.path;

    await upsertItem(ctx, vaultPath, meta.id, {
      item: {
        id: crypto.randomUUID(),
        vault_id: meta.id,
        title: "Welcome to Collector",
        description: "First offline item stored on disk and indexed in SQLite.",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        is_archived: false,
        is_favorite: true,
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      content: "# Collector\n\nOffline vault is working.",
    });
  }

  activeVault = { meta, path: vaultPath };
  return { vault: meta, path: vaultPath };
}

/** @deprecated use ensureActiveVault */
export async function bootstrapDevVault(): Promise<{
  vault: VaultMeta;
  path: string;
  items: ItemFile[];
}> {
  const { vault, path } = await resolveActiveVault();
  const items = await listItemsOnDisk(getContext(), path);
  return { vault, path, items };
}

export async function ensureActiveVault(): Promise<{
  vault: VaultMeta;
  path: string;
}> {
  return resolveActiveVault();
}

export async function listItems(): Promise<ItemFile[]> {
  const { vault, path } = await resolveActiveVault();
  await ensureVaultIndexSynced(vault.id, path);
  return listItemsOnDisk(getContext(), path);
}

export async function searchItems(
  query: string,
  filter: NavFilter,
): Promise<ItemFile[]> {
  const ftsQuery = buildFtsMatchQuery(query);
  const { vault, path } = await resolveActiveVault();
  await ensureVaultIndexSynced(vault.id, path);

  if (!ftsQuery) {
    if (isTagFilter(filter)) {
      const itemIds = await getIndex().listItemIdsByTag(vault.id, filter.tagId);
      return listItemsByIds(getContext(), path, itemIds);
    }
    if (isFolderFilter(filter)) {
      const itemIds = await getIndex().listItemIdsByFolderPrefix(
        vault.id,
        filter.folderPath,
      );
      return listItemsByIds(getContext(), path, itemIds);
    }

    const items = await listItemsOnDisk(getContext(), path);
    return items.filter((item) => matchesNavFilter(item, filter));
  }

  const itemIds = await getIndex().searchItemIds(vault.id, ftsQuery, filter);
  return listItemsByIds(getContext(), path, itemIds);
}

function matchesNavFilter(item: ItemFile, filter: NavFilter): boolean {
  if (isTagFilter(filter)) {
    return !item.is_archived && item.tag_ids.includes(filter.tagId);
  }
  if (isFolderFilter(filter)) {
    if (item.is_archived) {
      return false;
    }
    const path = filter.folderPath;
    return (
      item.folder_path === path ||
      item.folder_path.startsWith(`${path}/`)
    );
  }
  if (filter === "all") {
    return !item.is_archived;
  }
  if (filter === "favorite") {
    return item.is_favorite;
  }
  return item.is_archived;
}

export async function getItemById(
  itemId: string,
): Promise<{ item: ItemFile; content: string | null }> {
  const { path } = await resolveActiveVault();
  const itemPath = itemRoot(path, itemId);

  if (!(await fs.exists(itemPath))) {
    throw new Error(`Item not found: ${itemId}`);
  }

  const item = await readItemFile(fs, itemPath);
  const content = await readItemContent(fs, itemPath);
  return { item, content };
}

export async function createItem(input: CreateItemInput): Promise<ItemFile> {
  const { vault, path } = await resolveActiveVault();
  const timestamp = new Date().toISOString();

  return upsertItem(getContext(), path, vault.id, {
    item: {
      id: crypto.randomUUID(),
      vault_id: vault.id,
      title: input.title,
      description: input.description ?? "",
      url: input.url ?? null,
      content_type: input.content_type,
      source_type: "manual",
      metadata: {},
      is_archived: false,
      is_favorite: false,
      tag_ids: [],
      collection_ids: [],
      folder_path: "",
      content_revision: 1,
      created_at: timestamp,
      updated_at: timestamp,
    },
    content: input.content ?? null,
  });
}

export async function updateItem(
  itemId: string,
  input: UpdateItemInput,
): Promise<ItemFile> {
  const { vault, path } = await resolveActiveVault();
  const { item: existing, content: existingContent } = await getItemById(itemId);

  return upsertItem(getContext(), path, vault.id, {
    item: {
      ...existing,
      title: input.title ?? existing.title,
      description: input.description ?? existing.description,
      url: input.url !== undefined ? input.url : existing.url,
      content_type: input.content_type ?? existing.content_type,
      is_favorite: input.is_favorite ?? existing.is_favorite,
      is_archived: input.is_archived ?? existing.is_archived,
      tag_ids: input.tag_ids ?? existing.tag_ids,
      folder_path: input.folder_path ?? existing.folder_path,
    },
    content: input.content !== undefined ? input.content : existingContent,
  });
}

export async function deleteItem(itemId: string): Promise<void> {
  const { path } = await resolveActiveVault();
  await deleteItemOnDisk(getContext(), path, itemId);
}

export async function getDataDirectory(): Promise<string> {
  await ensureInitialized();
  return dataDir;
}

export async function listVaults(): Promise<VaultMeta[]> {
  const entries = await listVaultEntries();
  return entries.map((entry) => entry.meta);
}

export async function getActiveVaultMeta(): Promise<VaultMeta> {
  const { vault } = await resolveActiveVault();
  return vault;
}

export async function switchVault(vaultId: string): Promise<VaultMeta> {
  const entries = await listVaultEntries();
  const selected = entries.find((entry) => entry.meta.id === vaultId);
  if (!selected) {
    throw new Error(`Vault not found: ${vaultId}`);
  }

  activeVault = selected;
  await updateAppSettings({ active_vault_id: vaultId });
  return selected.meta;
}

export async function setDefaultVault(vaultId: string): Promise<void> {
  const ctx = getContext();
  const entries = await listVaultEntries();
  const selected = entries.find((entry) => entry.meta.id === vaultId);
  if (!selected) {
    throw new Error(`Vault not found: ${vaultId}`);
  }

  const timestamp = new Date().toISOString();
  for (const entry of entries) {
    const isDefault = entry.meta.id === vaultId;
    if (entry.meta.is_default === isDefault) {
      continue;
    }

    const updated: VaultMeta = {
      ...entry.meta,
      is_default: isDefault,
      updated_at: timestamp,
    };
    await writeVaultMeta(fs, entry.path, updated);
    await ctx.index.upsertVault(updated, entry.path);

    if (activeVault?.meta.id === entry.meta.id) {
      activeVault = { meta: updated, path: entry.path };
    }
  }
}

export async function listTags(): Promise<TagWithCount[]> {
  const { vault, path } = await resolveActiveVault();
  await ensureVaultIndexSynced(vault.id, path);
  return listTagsWithCounts(getContext(), vault.id, path);
}

export async function createTag(input: {
  name: string;
  color?: string | null;
}): Promise<Tag> {
  const { vault, path } = await resolveActiveVault();
  await ensureVaultIndexSynced(vault.id, path);
  return createTagOnVault(getContext(), path, vault.id, input);
}

export async function updateTagRecord(
  tagId: string,
  input: { name?: string; color?: string | null },
): Promise<Tag> {
  const { vault, path } = await resolveActiveVault();
  await ensureVaultIndexSynced(vault.id, path);
  return updateTagOnVault(getContext(), path, vault.id, tagId, input);
}

export async function deleteTag(tagId: string): Promise<void> {
  const { vault, path } = await resolveActiveVault();
  await ensureVaultIndexSynced(vault.id, path);
  await deleteTagOnVault(getContext(), path, vault.id, tagId);
}

export async function listFolderTree(): Promise<FolderTreeNode[]> {
  const { vault, path } = await resolveActiveVault();
  await ensureVaultIndexSynced(vault.id, path);
  return listFolderTreeOnVault(getContext(), path, vault.id);
}

export async function createFolder(folderPath: string): Promise<string> {
  const { vault, path } = await resolveActiveVault();
  await ensureVaultIndexSynced(vault.id, path);
  return createFolderOnVault(getContext(), path, folderPath);
}

export async function renameFolder(
  oldPath: string,
  newPath: string,
): Promise<string> {
  const { vault, path } = await resolveActiveVault();
  await ensureVaultIndexSynced(vault.id, path);
  return renameFolderOnVault(getContext(), path, vault.id, oldPath, newPath);
}

export async function deleteFolder(folderPath: string): Promise<void> {
  const { vault, path } = await resolveActiveVault();
  await ensureVaultIndexSynced(vault.id, path);
  await deleteFolderOnVault(getContext(), path, vault.id, folderPath);
}

export async function moveItemToFolderPath(
  itemId: string,
  folderPath: string,
): Promise<ItemFile> {
  const { vault, path } = await resolveActiveVault();
  await ensureVaultIndexSynced(vault.id, path);
  return moveItemToFolder(getContext(), path, vault.id, itemId, folderPath);
}
