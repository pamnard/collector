import { appDataDir, join } from "@tauri-apps/api/path";
import { applyInitialMigration } from "@collector/db";
import type { ItemFile, VaultMeta } from "@collector/shared";
import {
  SqlVaultIndexStore,
  createVault,
  listItemsOnDisk,
  readVaultMeta,
  upsertItem,
  userVaultsRoot,
  vaultRoot,
} from "@collector/core";
import { TauriFileSystemAdapter } from "../adapters/tauri-fs";
import { TauriSqlAdapter } from "../adapters/tauri-sql";

const DEV_USER_ID = "00000000-0000-4000-8000-000000000001";

let initialized = false;
let dataDir = "";
let sql: TauriSqlAdapter | null = null;
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

export async function bootstrapDevVault(): Promise<{
  vault: VaultMeta;
  path: string;
  items: ItemFile[];
}> {
  await ensureInitialized();

  const ctx = { fs, index: getIndex() };
  const vaultsRoot = userVaultsRoot(dataDir, DEV_USER_ID);
  await fs.mkdir(vaultsRoot);

  let vaultPath = "";
  let meta: VaultMeta | null = null;

  const vaultIds = (await fs.exists(vaultsRoot)) ? await fs.readDir(vaultsRoot) : [];
  for (const vaultId of vaultIds) {
    const candidatePath = vaultRoot(vaultsRoot, vaultId);
    if (await fs.exists(candidatePath)) {
      meta = await readVaultMeta(fs, candidatePath);
      vaultPath = candidatePath;
      break;
    }
  }

  if (!meta) {
    const created = await createVault(ctx, dataDir, {
      userId: DEV_USER_ID,
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

  const items = await listItemsOnDisk(ctx, vaultPath);
  return { vault: meta, path: vaultPath, items };
}

export async function getDataDirectory(): Promise<string> {
  await ensureInitialized();
  return dataDir;
}
