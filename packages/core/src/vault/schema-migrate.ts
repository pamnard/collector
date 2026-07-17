import {
  SCHEMA_VERSION,
  itemFileSchema,
  vaultMetaSchema,
  type ItemFile,
  type VaultMeta,
} from "@collector/shared";
import type { FileSystemAdapter } from "../adapters/types.js";
import {
  itemIdFromItemRoot,
  readItemFile,
  writeItemDocument,
  writeVaultMeta,
} from "./item-io.js";
import {
  filterDiskItemIds,
  itemLegacyMetaPath,
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

function migrateVaultMetaToCurrent(raw: RawRecord, sourceVersion: number): RawRecord {
  let migrated = raw;
  if (sourceVersion < 2) {
    migrated = migrateVaultMetaV1ToV2(migrated);
  }
  if (sourceVersion < 3) {
    migrated = {
      ...migrated,
      schema_version: 3,
      updated_at: new Date().toISOString(),
    };
  }
  return migrated;
}

/**
 * Convert legacy `item.json` (+ optional plain `content.md` body) into a
 * frontmatter markdown document. Idempotent when only `content.md` remains.
 */
export async function migrateItemSchema(
  fs: FileSystemAdapter,
  itemPath: string,
  vaultId: string,
): Promise<ItemFile> {
  const legacyPath = itemLegacyMetaPath(itemPath);
  const documentPath = itemMetaPath(itemPath);
  const hasLegacy = await fs.exists(legacyPath);

  if (!hasLegacy) {
    return readItemFile(fs, itemPath, vaultId);
  }

  const raw = JSON.parse(await fs.readText(legacyPath)) as RawRecord;
  const sourceVersion =
    typeof raw.schema_version === "number" ? raw.schema_version : 1;
  const migratedFields = sourceVersion < 2 ? migrateItemV1ToV2(raw) : raw;
  const item = itemFileSchema.parse({
    ...migratedFields,
    id:
      typeof migratedFields.id === "string"
        ? migratedFields.id
        : itemIdFromItemRoot(itemPath),
    vault_id: vaultId,
  });

  // Legacy body: if content.md exists alongside item.json, treat entire file as body
  // (pre-v3 content.md had no frontmatter).
  let body = "";
  if (await fs.exists(documentPath)) {
    body = await fs.readText(documentPath);
  }

  await writeItemDocument(fs, itemPath, item, body);
  await fs.remove(legacyPath);
  return item;
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
    migratedVault = migrateVaultMetaToCurrent(migratedVault, sourceVersion);
    const meta = vaultMetaSchema.parse(migratedVault);
    await writeVaultMeta(fs, vaultPath, meta);
  }

  const vaultId = String(
    (sourceVersion < SCHEMA_VERSION ? migratedVault : raw).id,
  );
  const itemsDir = itemsRoot(vaultPath);
  if (await fs.exists(itemsDir)) {
    for (const itemId of filterDiskItemIds(await fs.readDir(itemsDir))) {
      await migrateItemSchema(fs, itemRoot(vaultPath, itemId), vaultId);
    }
  }

  return vaultMetaSchema.parse(
    sourceVersion < SCHEMA_VERSION ? migratedVault : raw,
  );
}
