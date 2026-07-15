import {
  SCHEMA_VERSION,
  itemFileSchema,
  vaultMetaSchema,
  type ItemFile,
  type VaultMeta,
} from "@collector/shared";
import type { FileSystemAdapter } from "../adapters/types.js";
import { writeItemFile, writeVaultMeta } from "./item-io.js";
import {
  filterDiskItemIds,
  itemMetaPath,
  itemRoot,
  itemsRoot,
  vaultMetaPath,
} from "./paths.js";

type RawRecord = Record<string, unknown>;

function migrateVaultMetaV1ToV2(raw: RawRecord): RawRecord {
  return {
    ...raw,
    settings: raw.settings ?? {},
    schema_version: 2,
    updated_at: new Date().toISOString(),
  };
}

function migrateItemV1ToV2(raw: RawRecord): RawRecord {
  return {
    ...raw,
    tag_ids: raw.tag_ids ?? [],
    collection_ids: raw.collection_ids ?? [],
    folder_path: raw.folder_path ?? "",
    content_revision: raw.content_revision ?? 1,
    updated_at: new Date().toISOString(),
  };
}

export async function migrateVaultSchema(
  fs: FileSystemAdapter,
  vaultPath: string,
): Promise<VaultMeta> {
  const raw = JSON.parse(await fs.readText(vaultMetaPath(vaultPath))) as RawRecord;
  const sourceVersion =
    typeof raw.schema_version === "number" ? raw.schema_version : 1;

  let migratedVault = raw;
  if (sourceVersion < SCHEMA_VERSION) {
    if (sourceVersion < 2) {
      migratedVault = migrateVaultMetaV1ToV2(migratedVault);
    }
    const meta = vaultMetaSchema.parse(migratedVault);
    await writeVaultMeta(fs, vaultPath, meta);
  }

  const itemsDir = itemsRoot(vaultPath);
  if (await fs.exists(itemsDir)) {
    for (const itemId of filterDiskItemIds(await fs.readDir(itemsDir))) {
      await migrateItemSchema(fs, itemRoot(vaultPath, itemId));
    }
  }

  return vaultMetaSchema.parse(
    sourceVersion < SCHEMA_VERSION ? migratedVault : raw,
  );
}

export async function migrateItemSchema(
  fs: FileSystemAdapter,
  itemPath: string,
): Promise<ItemFile> {
  const raw = JSON.parse(await fs.readText(itemMetaPath(itemPath))) as RawRecord;
  const sourceVersion =
    typeof raw.schema_version === "number" ? raw.schema_version : 1;

  if (sourceVersion >= SCHEMA_VERSION) {
    return itemFileSchema.parse(raw);
  }

  const migrated = sourceVersion < 2 ? migrateItemV1ToV2(raw) : raw;
  const item = itemFileSchema.parse(migrated);
  await writeItemFile(fs, itemPath, item);
  return item;
}
