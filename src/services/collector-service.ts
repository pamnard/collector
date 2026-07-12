import { appDataDir, join } from "@tauri-apps/api/path";
import { applyInitialMigration } from "@collector/db";
import type { ItemFile, VaultMeta } from "@collector/shared";
import {
  SqlVaultIndexStore,
  createVault,
  itemRoot,
  listItemsOnDisk,
  readItemContent,
  readItemFile,
  readVaultMeta,
  upsertItem,
  vaultRoot,
  vaultsRoot,
} from "@collector/core";
import { TauriFileSystemAdapter } from "../adapters/tauri-fs";
import { TauriSqlAdapter } from "../adapters/tauri-sql";

let initialized = false;
let dataDir = "";
let sql: TauriSqlAdapter | null = null;
let activeVault: { meta: VaultMeta; path: string } | null = null;
const fs = new TauriFileSystemAdapter();

async function ensureInitialized(): Promise<void> {
  if (initialized) {
    return;
  }

  dataDir = await join(await appDataDir(), "collector");
  sql = await TauriSqlAdapter.open();
  await applyInitialMigration(sql);
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

async function resolveActiveVault(): Promise<{ vault: VaultMeta; path: string }> {
  await ensureInitialized();

  if (activeVault) {
    return { vault: activeVault.meta, path: activeVault.path };
  }

  const ctx = getContext();
  const root = vaultsRoot(dataDir);
  await fs.mkdir(root);

  let vaultPath = "";
  let meta: VaultMeta | null = null;

  const vaultIds = (await fs.exists(root)) ? await fs.readDir(root) : [];
  for (const vaultId of vaultIds) {
    const candidatePath = vaultRoot(root, vaultId);
    if (await fs.exists(candidatePath)) {
      meta = await readVaultMeta(fs, candidatePath);
      vaultPath = candidatePath;
      break;
    }
  }

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
  const { path } = await resolveActiveVault();
  return listItemsOnDisk(getContext(), path);
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

export async function getDataDirectory(): Promise<string> {
  await ensureInitialized();
  return dataDir;
}
